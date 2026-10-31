// path: src/pages/api/push/guest-broadcast.ts
// ============================================================
// API: অ্যাডমিনের প্রমো মেসেজ — লগইন ছাড়া ইনস্টলড অ্যাপগুলোতে (গেস্ট ডিভাইস)
//
// ফ্লো:
//   ১) অ্যাডমিনের Bearer টোকেন যাচাই + profiles.role === 'admin' (মডারেটর না)
//   ২) মেসেজটা guest_promos টেবিলে সেভ — গেস্টরা অ্যাপের "মেসেজ" বক্সে
//      (লগইন ছাড়াই) এই পাবলিক তালিকা দেখতে পায়
//   ৩) guest_push_devices-এর সব টোকেনে FCM পুশ (৫০০ করে ব্যাচে),
//      "অফার" চ্যানেলে (sf_promo_v1)। লগইন করা ইউজারের টোকেন (push_subscriptions)
//      বাদ — তারা নিজেদের ইনবক্সের পথেই পায়, দুইবার যাবে না।
//      uninstalled_at বসা (আনইনস্টল হয়ে যাওয়া) টোকেন বাদ।
//   ৪) আনইনস্টল হওয়া টোকেন (not-registered / invalid-registration-token)
//      ডিলিট না করে uninstalled_at = now() বসানো হয় (আনইনস্টল ট্র্যাকিংয়ের জন্য)।
//      শুধু অবৈধ ফরম্যাটের টোকেন (invalid-argument) ডিলিট হয়।
//
// শুধু প্রমো: এখানে শুধু অফার/ঘোষণা যায়। ব্যক্তিগত বা সিকিউরিটি মেসেজ কখনো
// গেস্ট ডিভাইসে যায় না।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { callerCan } from '../../../lib/serverPermission.js';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const HOUR = 60 * 60 * 1000;
const PROMO_CHANNEL = 'sf_promo_v1';
const BRAND_COLOR = '#FF6B35';
const GUEST_PROMO_TITLE = 'স্মার্ট ফেনী';
const FCM_BATCH = 500;
const PAGE = 1000;

const ROUTE = '/api/push/guest-broadcast';

function getFirebaseAdmin() {
  if (getApps().length > 0) return getApp();

  const projectId = import.meta.env.FIREBASE_PROJECT_ID;
  const clientEmail = import.meta.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (import.meta.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

// পাতা করে সব সারি আনা (Supabase একবারে সর্বোচ্চ ১০০০)
// onlyActive = true হলে uninstalled_at বসা সারি বাদ
async function fetchAll(supabaseAdmin, table: string, column: string, onlyActive = false) {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin.from(table).select(column);
    if (onlyActive) query = query.is('uninstalled_at', null);
    const { data, error } = await query
      .order(column, { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map((r) => r[column]).filter(Boolean));
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function POST({ request }) {
  // এরর রিপোর্টের ক্লায়েন্ট (service role) — তৈরি হওয়ার পর বসে
  let reportDb: any = null;

  try {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    reportDb = supabaseAdmin;

    // ---------- অ্যাডমিন যাচাই ----------
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (!token) return json({ error: 'লগইন প্রয়োজন' }, 401);

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !userData?.user) return json({ error: 'ইউজার ভেরিফিকেশন ব্যর্থ' }, 401);

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .maybeSingle();

    if (!(await callerCan(supabaseAdmin, userData.user.id, 'notifications.manage'))) return json({ error: 'এই কাজের অনুমতি নেই' }, 403);

    // ---------- ইনপুট যাচাই ----------
    const body = await request.json();
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (!message || message.length > 1500) return json({ error: 'মেসেজ ১–১৫০০ অক্ষরের মধ্যে হতে হবে' }, 400);

    const actionUrlRaw = typeof body?.action_url === 'string' ? body.action_url.trim() : '';
    const actionUrl = actionUrlRaw || null;
    if (actionUrl) {
      const okInternal = actionUrl.startsWith('/') && !actionUrl.startsWith('//') && !actionUrl.includes('\\');
      const okHttps = /^https:\/\/[^\s]+$/i.test(actionUrl);
      if (!okInternal && !okHttps) return json({ error: 'লিংক অবৈধ' }, 400);
    }

    const linkLabel = typeof body?.link_label === 'string' && body.link_label.trim()
      ? body.link_label.trim().slice(0, 120)
      : null;
    const imageUrl = typeof body?.image_url === 'string' && /^https:\/\/[^\s]+$/i.test(body.image_url)
      ? body.image_url
      : null;

    // ---------- ১) পাবলিক প্রমো তালিকায় সেভ ----------
    const { data: promoRow, error: promoError } = await supabaseAdmin
      .from('guest_promos')
      .insert({
        title: GUEST_PROMO_TITLE,
        body: message,
        action_url: actionUrl,
        link_label: linkLabel,
        image_url: imageUrl,
      })
      .select('id')
      .single();

    if (promoError || !promoRow) {
      await reportServerError(reportDb, {
        route: ROUTE,
        action: 'push_guest_broadcast_promo_insert',
        title: 'গেস্ট প্রমো সেভ ব্যর্থ',
        message: promoError?.message || 'insert থেকে কোনো রো ফেরত আসেনি',
        code: promoError?.code,
        status: 500,
      });
      return json({ error: 'প্রমো সেভ ব্যর্থ' }, 500);
    }

    // ---------- ২) টার্গেট টোকেন (লগইন করা ডিভাইস ও আনইনস্টল হওয়া বাদ) ----------
    const [guestTokens, loggedInTokens] = await Promise.all([
      fetchAll(supabaseAdmin, 'guest_push_devices', 'fcm_token', true),
      fetchAll(supabaseAdmin, 'push_subscriptions', 'fcm_token'),
    ]);
    const loggedInSet = new Set(loggedInTokens);
    const targets = guestTokens.filter((t) => !loggedInSet.has(t));

    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) {
      await reportServerError(reportDb, {
        route: ROUTE,
        action: 'push_guest_broadcast_firebase_missing',
        title: 'গেস্ট প্রমো: Firebase কনফিগ নেই (পুশ যায়নি)',
        message: 'FIREBASE_* env ভেরিয়েবল পাওয়া যায়নি',
        status: 200,
      });
      return json({ success: true, promo_id: promoRow.id, devices: targets.length, sent: 0, note: 'Firebase কনফিগার করা নেই — শুধু তালিকায় সেভ হয়েছে' });
    }

    // ---------- ৩) FCM পাঠানো ----------
    const messaging = getMessaging(firebaseApp);
    const shortBody = message.length > 300 ? message.slice(0, 297) + '...' : message;

    let sent = 0;
    let failed = 0;
    const uninstalledTokens: string[] = []; // আনইনস্টল: uninstalled_at বসবে
    const otherFailCodes = new Set<string>(); // আনইনস্টল/অবৈধ ছাড়া বাকি FCM এরর কোড (শুধু কোড)
    const invalidTokens: string[] = [];     // অবৈধ ফরম্যাট: ডিলিট হবে

    for (let i = 0; i < targets.length; i += FCM_BATCH) {
      const chunk = targets.slice(i, i + FCM_BATCH);
      const res = await messaging.sendEachForMulticast({
        tokens: chunk,
        notification: {
          title: GUEST_PROMO_TITLE,
          body: shortBody,
          imageUrl: imageUrl || undefined,
        },
        data: {
          notification_id: '',
          category: 'promo',
          priority: 'normal',
          related_entity_id: '',
          action_url: actionUrl || '',
          guest_promo_id: String(promoRow.id),
        },
        android: {
          priority: 'normal',
          ttl: 24 * HOUR,
          notification: { channelId: PROMO_CHANNEL, color: BRAND_COLOR },
        },
      });

      sent += res.successCount;
      failed += res.failureCount;

      res.responses.forEach((r, idx) => {
        if (!r.success) {
          const code = r.error?.code || '';
          if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token'
          ) {
            uninstalledTokens.push(chunk[idx]);
          } else if (code === 'messaging/invalid-argument') {
            invalidTokens.push(chunk[idx]);
          } else {
            otherFailCodes.add(code || 'unknown');
          }
        }
      });
    }

    // ---------- ৪) আনইনস্টল হওয়া টোকেনে সময় বসানো, অবৈধ টোকেন ডিলিট ----------
    const nowIso = new Date().toISOString();
    let cleanupError: string | null = null;
    for (let i = 0; i < uninstalledTokens.length; i += 200) {
      const { error: markError } = await supabaseAdmin
        .from('guest_push_devices')
        .update({ uninstalled_at: nowIso })
        .in('fcm_token', uninstalledTokens.slice(i, i + 200))
        .is('uninstalled_at', null);
      if (markError && !cleanupError) cleanupError = markError.message;
    }
    for (let i = 0; i < invalidTokens.length; i += 200) {
      const { error: deleteError } = await supabaseAdmin
        .from('guest_push_devices')
        .delete()
        .in('fcm_token', invalidTokens.slice(i, i + 200));
      if (deleteError && !cleanupError) cleanupError = deleteError.message;
    }

    // আনইনস্টল (not-registered) স্বাভাবিক — রিপোর্ট নয়। বাকি FCM এরর ও ক্লিনআপ এরর রিপোর্ট
    if (otherFailCodes.size > 0) {
      const failCodes = Array.from(otherFailCodes).sort();
      await reportServerError(reportDb, {
        route: ROUTE,
        action: 'push_guest_broadcast_fcm_failed',
        title: 'গেস্ট প্রমো: FCM ব্যর্থতা',
        message: 'FCM ব্যর্থ — ' + failCodes.join(', '),
        code: failCodes[0],
        status: 200,
      });
    }
    if (cleanupError) {
      await reportServerError(reportDb, {
        route: ROUTE,
        action: 'push_guest_broadcast_cleanup',
        title: 'গেস্ট প্রমো: টোকেন ক্লিনআপ ব্যর্থ',
        message: cleanupError,
        status: 200,
      });
    }

    return json({
      success: true,
      promo_id: promoRow.id,
      devices: targets.length,
      sent,
      failed,
      uninstalled: uninstalledTokens.length,
      cleaned: invalidTokens.length,
    });
  } catch (err) {
    console.error('guest-broadcast এরর:', String(err));
    await reportServerError(reportDb, {
      route: ROUTE,
      action: 'push_guest_broadcast_unexpected',
      title: 'গেস্ট প্রমো: অপ্রত্যাশিত ক্র্যাশ',
      message: String(err),
      status: 500,
    });
    return json({ error: 'সার্ভার এরর' }, 500);
  }
}
