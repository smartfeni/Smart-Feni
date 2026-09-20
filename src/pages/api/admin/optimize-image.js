// ============================================================
// API এন্ডপয়েন্ট: ছবি অপটিমাইজ (/api/admin/optimize-image)
// শুধু admin রোল কল করতে পারবে।
//
// কেন লাগলো: প্রোফাইল ছবি গড়ে ১.১ MB, ক্লাব কভার ~১ MB — হেডারের ছোট
// আইকনের জন্যও এত বড় ছবি নামছিল। অ্যাডমিন পেজ (/admin/optimize-images)
// ব্রাউজারে ছবি ছোট করে এই রুটে পাঠায়; এই রুট service role key দিয়ে
// (যেটা Vercel এ আগে থেকেই আছে — আলাদা করে কোথাও বসাতে হয় না)
// একই পাথে আবার আপলোড করে, ফলে কোনো ছবির লিংক বদলায় না।
//
// GET  ?prefix=avatars/  → ওই ফোল্ডারের এক স্তরের ফোল্ডার ও ফাইল (সাইজসহ)
// POST (multipart: path, file) → original কে _backup/<path> এ কপি করে,
//                                ছোট করা ছবি একই পাথে আপলোড (ক্যাশ ১ বছর)
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const BUCKET = 'listing-images';
const BACKUP_PREFIX = '_backup/';
// এই ফোল্ডারগুলো কখনো ছোঁয়া হবে না
const BLOCKED_PREFIXES = ['site/', 'screenshot-imports/', BACKUP_PREFIX];
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024; // Vercel body limit (৪.৫MB) এর নিচে থাকতে
const CACHE_CONTROL = '31536000';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function mimeForPath(path) {
  const p = path.toLowerCase();
  if (p.endsWith('.png')) return 'image/png';
  if (p.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function isSafePath(path) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    path.length < 400 &&
    !path.includes('..') &&
    !path.startsWith('/') &&
    !/[\u0000-\u001f]/.test(path)
  );
}

function isBlocked(path) {
  return BLOCKED_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function verifyAdmin(request, supabaseAdmin) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  const { data: callerData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !callerData?.user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();

  if (!profile || profile.role !== 'admin') return null;
  return callerData.user;
}

function getAdminClient() {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

// ---------- GET: এক স্তরের ফোল্ডার/ফাইল তালিকা ----------
export async function GET({ request, url }) {
  try {
    const supabaseAdmin = getAdminClient();
    if (!supabaseAdmin) return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);

    const caller = await verifyAdmin(request, supabaseAdmin);
    if (!caller) return json({ error: 'অনুমতি নেই' }, 403);

    const prefix = url.searchParams.get('prefix') || '';
    if (prefix && (!isSafePath(prefix) || !prefix.endsWith('/'))) {
      return json({ error: 'অবৈধ prefix' }, 400);
    }
    if (prefix && isBlocked(prefix)) return json({ folders: [], files: [] });

    const folderPath = prefix.replace(/\/$/, '');
    const folders = [];
    const files = [];
    let offset = 0;
    const pageSize = 100;

    for (;;) {
      const { data, error } = await supabaseAdmin.storage.from(BUCKET).list(folderPath, {
        limit: pageSize,
        offset,
        sortBy: { column: 'name', order: 'asc' },
      });
      if (error) return json({ error: 'তালিকা আনা ব্যর্থ: ' + error.message }, 500);

      for (const item of data || []) {
        if (!item.name) continue;
        if (item.id === null || item.id === undefined) {
          folders.push(item.name);
        } else if (IMAGE_EXT.test(item.name)) {
          files.push({ name: item.name, size: Number(item.metadata?.size) || 0 });
        }
      }

      if (!data || data.length < pageSize) break;
      offset += pageSize;
    }

    return json({ folders, files });
  } catch (err) {
    console.error('optimize-image GET এরর:', err);
    return json({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }, 500);
  }
}

// ---------- POST: ছোট করা ছবি আপলোড (আগে ব্যাকআপ) ----------
export async function POST({ request }) {
  try {
    const supabaseAdmin = getAdminClient();
    if (!supabaseAdmin) return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);

    const caller = await verifyAdmin(request, supabaseAdmin);
    if (!caller) return json({ error: 'অনুমতি নেই' }, 403);

    const formData = await request.formData();
    const path = formData.get('path');
    const file = formData.get('file');
    const requestedContentType = formData.get('contentType');

    if (!isSafePath(path) || !IMAGE_EXT.test(path) || isBlocked(path)) {
      return json({ error: 'এই পাথের ছবি বদলানো যাবে না' }, 400);
    }
    if (!file || typeof file === 'string' || !file.size) {
      return json({ error: 'ফাইল পাওয়া যায়নি' }, 400);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      return json({ error: 'ফাইল বেশি বড়' }, 413);
    }

    // ক্লায়েন্ট মাঝেমধ্যে ফরম্যাট বদলে দেয় (যেমন PNG ফটোকে JPEG করে, পাথ
    // অপরিবর্তিত রেখেই) — তাই path এর extension থেকে অনুমান না করে, ক্লায়েন্ট
    // যা পাঠিয়েছে সেটাই ব্যবহার করা হচ্ছে (allow-list দিয়ে যাচাই করে)
    const ALLOWED_CONTENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
    const contentType = ALLOWED_CONTENT_TYPES.has(requestedContentType)
      ? requestedContentType
      : mimeForPath(path);

    // ১) original ব্যাকআপ (আগে থেকে ব্যাকআপ থাকলে সেটাই আসল — সেটা ছোঁয়া হয় না)
    const { error: copyError } = await supabaseAdmin.storage
      .from(BUCKET)
      .copy(path, BACKUP_PREFIX + path);

    if (copyError && !/exist|duplicate|already/i.test(copyError.message || '')) {
      return json({ error: 'ব্যাকআপ ব্যর্থ: ' + copyError.message }, 500);
    }

    // ২) ছোট করা ছবি একই পাথে (লিংক বদলায় না)
    const arrayBuffer = await file.arrayBuffer();
    const { error: uploadError } = await supabaseAdmin.storage.from(BUCKET).upload(path, arrayBuffer, {
      upsert: true,
      contentType,
      cacheControl: CACHE_CONTROL,
    });

    if (uploadError) {
      return json({ error: 'আপলোড ব্যর্থ: ' + uploadError.message }, 500);
    }

    return json({ ok: true, size: file.size });
  } catch (err) {
    console.error('optimize-image POST এরর:', err);
    return json({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }, 500);
  }
}
