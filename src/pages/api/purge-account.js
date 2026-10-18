// path: src/pages/api/purge-account.js
// ============================================================
// API এন্ডপয়েন্ট: মেয়াদ শেষ হওয়া অ্যাকাউন্টের স্থায়ী ডিলিট (/api/purge-account)
//
// ফ্লো: ইউজার profile/edit থেকে request_account_deletion() RPC দিয়ে ডিলিটের
// অনুরোধ করে → ৭ দিনের গ্রেস পিরিয়ড (এর মধ্যে লগইন করে ফিরিয়ে আনা যায়) →
// pg_cron `purge-deleted-accounts` (প্রতি ৬ ঘণ্টায়) dispatch_account_purges()
// দিয়ে মেয়াদ-শেষ প্রতিটা রো-র জন্য এই রুট কল করে (pg_net, X-Internal-Secret)।
//
// এই রুট যা করে:
//   ১) X-Internal-Secret যাচাই (push/send-এর মতোই; বাইরের কেউ কল করলে 401)
//   ২) account_deletions রো এখনো pending ও মেয়াদ-শেষ কিনা আবার যাচাই
//      (এর মধ্যে ইউজার রিস্টোর করে ফেললে কিছু না করে ফিরে যায়)
//   ৩) অ্যাডমিন/মডারেটর হলে কখনো ডিলিট করে না
//   ৪) স্টোরেজের ইউজারের নিজের ছবি মোছে (best-effort; ব্যর্থ হলে ডিলিট আটকায় না)
//   ৫) Auth ইউজার ডিলিট → FK cascade-এ প্রোফাইল, লিস্টিং ইত্যাদি মুছে যায়
//   ৬) account_deletions রো `completed` হয়, user_id ফাঁকা হয় (শুধু স্ট্যাট থাকে)
//
// নিরাপত্তা (স্টোরেজ): লিস্টিংয়ের images ইউজারের লেখা ডেটা, তাই কেউ অন্যের
// ছবির URL বসিয়ে রাখলে সেটা যেন মুছে না যায় — শুধু সেই ফাইলই মোছা হয় যার
// পাথে ইউজারের নিজের আইডি (বা তার রাইডার আইডি) আছে।
//
// ব্যর্থ হলে: last_purge_error-এ কারণ লেখা হয় এবং /admin/errors-এ রিপোর্ট
// যায়; cron সর্বোচ্চ ৫ বার চেষ্টা করে।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { reportServerError } from '../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/purge-account';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// শুধু এই বাকেটগুলো থেকেই ফাইল মোছা হবে
const ALLOWED_BUCKETS = [
  'listing-images',
  'rider-photos',
  'rider-verification',
  'delivery-proofs',
  'chat-images',
];

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// পাবলিক/সাইনড URL থেকে {bucket, path}; URL না হলে (শুধু পাথ) fallbackBucket ধরা হয়
function parseStorageRef(value, fallbackBucket) {
  if (!value || typeof value !== 'string') return null;

  const m = value.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/([^?#]+)/);
  if (m) {
    let path = m[2];
    try {
      path = decodeURIComponent(path);
    } catch (e) {
      // ডিকোড না হলে যেমন আছে তেমন
    }
    return { bucket: m[1], path };
  }

  if (fallbackBucket && !/^https?:\/\//i.test(value)) {
    return { bucket: fallbackBucket, path: value.replace(/^\/+/, '') };
  }
  return null;
}

// ইউজারের সব ফাইলের রেফারেন্স জড়ো করে বাকেট অনুযায়ী ভাগ করে
async function collectFiles(db, userId, profile) {
  const refs = [];
  const add = (value, fallbackBucket) => {
    const r = parseStorageRef(value, fallbackBucket);
    if (r) refs.push(r);
  };
  const ownerIds = [userId];

  if (profile?.avatar_url) add(profile.avatar_url, 'listing-images');

  const { data: listings } = await db.from('listings').select('images').eq('user_id', userId);
  for (const l of listings || []) {
    for (const v of l.images || []) add(v, 'listing-images');
  }

  const { data: riders } = await db
    .from('delivery_riders')
    .select('id, photo_url, id_card_photo_url')
    .eq('profile_id', userId);
  for (const r of riders || []) {
    ownerIds.push(r.id);
    add(r.photo_url, 'rider-photos');
    add(r.id_card_photo_url, 'rider-verification');
  }

  const { data: msgs } = await db
    .from('delivery_chat_messages')
    .select('image_url')
    .eq('sender_id', userId)
    .not('image_url', 'is', null);
  for (const m of msgs || []) add(m.image_url, 'chat-images');

  const { data: proofs } = await db
    .from('delivery_payment_proofs')
    .select('image_urls')
    .eq('uploaded_by', userId);
  for (const p of proofs || []) {
    for (const v of p.image_urls || []) add(v, 'delivery-proofs');
  }

  const byBucket = {};
  let skipped = 0;
  for (const r of refs) {
    const safe =
      ALLOWED_BUCKETS.includes(r.bucket) &&
      !r.path.includes('..') &&
      ownerIds.some((id) => id && r.path.includes(id));
    if (!safe) {
      skipped += 1;
      continue;
    }
    if (!byBucket[r.bucket]) byBucket[r.bucket] = new Set();
    byBucket[r.bucket].add(r.path);
  }
  return { byBucket, skipped };
}

async function removeFiles(db, byBucket) {
  let removed = 0;
  const errors = [];
  for (const [bucket, set] of Object.entries(byBucket)) {
    const paths = Array.from(set);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      try {
        const { error } = await db.storage.from(bucket).remove(chunk);
        if (error) errors.push(`${bucket}: ${error.message}`);
        else removed += chunk.length;
      } catch (e) {
        errors.push(`${bucket}: ${e?.message || e}`);
      }
    }
  }
  return { removed, errors };
}

export async function POST({ request }) {
  let db = null;

  try {
    const internalSecret = request.headers.get('X-Internal-Secret');
    const expectedSecret = import.meta.env.PUSH_INTERNAL_SECRET;

    if (!expectedSecret || internalSecret !== expectedSecret) {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      console.error('purge-account: সার্ভার কনফিগারেশন ঠিক নেই');
      return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);
    }

    db = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await request.json().catch(() => ({}));
    const deletionId = body?.deletion_id;
    const userId = body?.user_id;

    if (!UUID_RE.test(deletionId || '') || !UUID_RE.test(userId || '')) {
      return json({ error: 'deletion_id ও user_id আবশ্যক' }, 400);
    }

    // ===== ২) এখনো pending ও মেয়াদ-শেষ কিনা আবার যাচাই =====
    const { data: rec, error: recError } = await db
      .from('account_deletions')
      .select('id, user_id, status, scheduled_for')
      .eq('id', deletionId)
      .maybeSingle();

    if (recError) {
      await reportServerError(db, {
        route: ROUTE,
        action: 'purge_read_record',
        title: 'অ্যাকাউন্ট পার্জ: রেকর্ড পড়া ব্যর্থ',
        message: recError.message,
        code: recError.code,
        status: 500,
      });
      return json({ error: 'রেকর্ড পড়া যায়নি' }, 500);
    }

    if (!rec || rec.status !== 'pending' || rec.user_id !== userId) {
      return json({ skipped: true, reason: 'not_pending' }, 200);
    }
    if (new Date(rec.scheduled_for).getTime() > Date.now()) {
      return json({ skipped: true, reason: 'not_due' }, 200);
    }

    // ===== ৩) স্টাফ অ্যাকাউন্ট কখনো না =====
    const { data: profile } = await db
      .from('profiles')
      .select('role, avatar_url')
      .eq('id', userId)
      .maybeSingle();

    if (profile && ['admin', 'moderator'].includes(profile.role)) {
      await db
        .from('account_deletions')
        .update({ last_purge_error: 'staff account — পার্জ বাতিল', purge_attempts: 5 })
        .eq('id', deletionId);
      return json({ skipped: true, reason: 'staff' }, 200);
    }

    // ===== ৪) স্টোরেজ ফাইল (best-effort) =====
    let fileResult = { removed: 0, errors: [] };
    let skippedFiles = 0;
    try {
      const { byBucket, skipped } = await collectFiles(db, userId, profile);
      skippedFiles = skipped;
      fileResult = await removeFiles(db, byBucket);
    } catch (e) {
      fileResult.errors.push(e?.message || String(e));
    }

    if (fileResult.errors.length > 0) {
      console.error('purge-account storage errors:', fileResult.errors.join(' | '));
      await reportServerError(db, {
        route: ROUTE,
        action: 'purge_storage_cleanup',
        title: 'অ্যাকাউন্ট পার্জ: কিছু ছবি মোছা যায়নি (অ্যাকাউন্ট ডিলিট চলছে)',
        message: fileResult.errors.join(' | ').slice(0, 500),
        status: 500,
      });
    }

    // ===== ৫) Auth ইউজার ডিলিট (FK cascade-এ বাকি সব) =====
    const { error: delError } = await db.auth.admin.deleteUser(userId);

    const alreadyGone =
      delError && (delError.status === 404 || /not.?found/i.test(delError.message || ''));

    if (delError && !alreadyGone) {
      console.error('purge-account deleteUser error:', delError.message);
      await db
        .from('account_deletions')
        .update({ last_purge_error: String(delError.message || 'deleteUser failed').slice(0, 300) })
        .eq('id', deletionId);
      await reportServerError(db, {
        route: ROUTE,
        action: 'purge_delete_user',
        title: 'অ্যাকাউন্ট পার্জ ব্যর্থ (Auth ডিলিট)',
        message: delError.message,
        code: delError.code || delError.status,
        status: 500,
      });
      return json({ error: 'ইউজার ডিলিট ব্যর্থ' }, 500);
    }

    // ===== ৬) স্ট্যাটাস completed, user_id ফাঁকা =====
    const { error: markError } = await db
      .from('account_deletions')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        user_id: null,
        last_purge_error: null,
      })
      .eq('id', deletionId);

    if (markError) {
      await reportServerError(db, {
        route: ROUTE,
        action: 'purge_mark_completed',
        title: 'অ্যাকাউন্ট পার্জ: স্ট্যাটাস আপডেট ব্যর্থ (ইউজার ডিলিট হয়ে গেছে)',
        message: markError.message,
        code: markError.code,
        status: 500,
      });
    }

    return json(
      { success: true, files_removed: fileResult.removed, files_skipped: skippedFiles },
      200
    );
  } catch (err) {
    console.error('purge-account API এরর:', err);
    await reportServerError(db, {
      route: ROUTE,
      action: 'purge_unexpected',
      title: 'অ্যাকাউন্ট পার্জ API অপ্রত্যাশিত এরর',
      message: err?.message || String(err),
      status: 500,
    });
    return json({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }, 500);
  }
}
