// path: src/pages/api/push/ping.ts
// ============================================================
// API: সাপ্তাহিক সাইলেন্ট ping (/api/push/ping) — আনইনস্টল ধরার জন্য
//
// ফ্লো:
//   ১) X-Internal-Secret যাচাই (শুধু Supabase pg_cron থেকে কল হবে)
//   ২) push_subscriptions (android) ও guest_push_devices থেকে uninstalled_at
//      ফাঁকা টোকেনগুলো আনা
//   ৩) প্রতিটা টোকেনে data-only FCM পাঠানো — notification অংশ নেই, তাই ফোনে
//      কিছু দেখায় না, কারও বিরক্তি হয় না (অ্যাপে foreground data handler নেই)
//   ৪) আনইনস্টল হওয়া টোকেনে (not-registered / invalid-registration-token)
//      uninstalled_at = now() বসানো হয়
//
// নোট: FCM আনইনস্টল জানতে ফোন অনলাইনে থাকা লাগে, তাই মেয়াদ (TTL) ৭ দিন
// রাখা হয়েছে এবং collapseKey দেওয়া আছে (একই ডিভাইসে একটার বেশি ping জমে না)।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const ROUTE = '/api/push/ping';

const HOUR = 60 * 60 * 1000;
const FCM_BATCH = 500;
const PAGE = 1000;

function getFirebaseAdmin() {
  if (getApps().length > 0) return getApp();

  const projectId = import.meta.env.FIREBASE_PROJECT_ID;
  const clientEmail = import.meta.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (import.meta.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

// পাতা করে সব সক্রিয় টোকেন আনা (Supabase একবারে সর্বোচ্চ ১০০০)
async function fetchActiveTokens(supabaseAdmin, table: string, extraFilter?: (q: any) => any) {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabaseAdmin
      .from(table)
      .select('fcm_token')
      .is('uninstalled_at', null)
      .not('fcm_token', 'is', null);
    if (extraFilter) query = extraFilter(query);
    const { data, error } = await query
      .order('fcm_token', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data || [];
    out.push(...rows.map((r) => r.fcm_token).filter(Boolean));
    if (rows.length < PAGE) break;
  }
  return out;
}

// একটা টেবিলের সব টোকেনে ping পাঠিয়ে আনইনস্টল হওয়াগুলোতে সময় বসানো
async function pingTable(supabaseAdmin, messaging, table: string, tokens: string[]) {
  let sent = 0;
  let failed = 0;
  const uninstalled: string[] = [];
  const otherCodes = new Set<string>(); // আনইনস্টল ছাড়া বাকি FCM এরর কোড (শুধু কোড)
  let updateError: string | null = null;

  for (let i = 0; i < tokens.length; i += FCM_BATCH) {
    const chunk = tokens.slice(i, i + FCM_BATCH);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      data: { type: 'ping' },
      android: {
        priority: 'normal',
        ttl: 7 * 24 * HOUR,
        collapseKey: 'sf_ping',
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
          uninstalled.push(chunk[idx]);
        } else {
          otherCodes.add(code || 'unknown');
        }
      }
    });
  }

  const nowIso = new Date().toISOString();
  for (let i = 0; i < uninstalled.length; i += 200) {
    const { error: markError } = await supabaseAdmin
      .from(table)
      .update({ uninstalled_at: nowIso })
      .in('fcm_token', uninstalled.slice(i, i + 200))
      .is('uninstalled_at', null);
    if (markError && !updateError) updateError = markError.message;
  }

  return {
    devices: tokens.length,
    sent,
    failed,
    uninstalled: uninstalled.length,
    otherFailCodes: Array.from(otherCodes),
    updateError,
  };
}

export async function POST({ request }) {
  // এরর রিপোর্টের ক্লায়েন্ট (service role) — তৈরি হওয়ার পর বসে
  let reportDb: any = null;

  try {
    const internalSecret = request.headers.get('X-Internal-Secret');
    const expectedSecret = import.meta.env.PUSH_INTERNAL_SECRET;

    if (!expectedSecret || internalSecret !== expectedSecret) {
      return json({ error: 'unauthorized' }, 401);
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);

    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) return json({ error: 'Firebase কনফিগার করা নেই' }, 500);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    reportDb = supabaseAdmin;
    const messaging = getMessaging(firebaseApp);

    const [subTokens, guestTokens] = await Promise.all([
      fetchActiveTokens(supabaseAdmin, 'push_subscriptions', (q) => q.eq('platform', 'android')),
      fetchActiveTokens(supabaseAdmin, 'guest_push_devices'),
    ]);

    const subscriptions = await pingTable(supabaseAdmin, messaging, 'push_subscriptions', subTokens);
    const guests = await pingTable(supabaseAdmin, messaging, 'guest_push_devices', guestTokens);

    // আনইনস্টল (not-registered) স্বাভাবিক — রিপোর্ট নয়। বাকি FCM এরর ও DB আপডেট এরর রিপোর্ট
    const pingResults: Array<[string, any]> = [
      ['push_subscriptions', subscriptions],
      ['guest_push_devices', guests],
    ];
    for (const [label, r] of pingResults) {
      if (r.otherFailCodes.length > 0) {
        await reportServerError(reportDb, {
          route: ROUTE,
          action: 'push_ping_fcm_failed',
          title: 'সাপ্তাহিক ping: FCM ব্যর্থতা',
          message: label + ': ' + r.otherFailCodes.join(', '),
          code: r.otherFailCodes[0],
          status: 200,
        });
      }
      if (r.updateError) {
        await reportServerError(reportDb, {
          route: ROUTE,
          action: 'push_ping_mark_uninstalled',
          title: 'সাপ্তাহিক ping: আনইনস্টল চিহ্নিত করা ব্যর্থ',
          message: label + ': ' + r.updateError,
          status: 200,
        });
      }
    }

    return json({ success: true, subscriptions, guests });
  } catch (err) {
    console.error('push/ping এরর:', String(err));
    await reportServerError(reportDb, {
      route: ROUTE,
      action: 'push_ping_unexpected',
      title: 'সাপ্তাহিক ping: অপ্রত্যাশিত ক্র্যাশ',
      message: String(err),
      status: 500,
    });
    return json({ error: 'সার্ভার এরর' }, 500);
  }
}
