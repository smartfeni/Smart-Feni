// path: src/pages/api/referral/retention.ts
// ============================================================
// API: রেফার রিটেনশন যাচাই (/api/referral/retention) — ২৪ ঘণ্টার শর্ত
//
// ফ্লো (pg_cron প্রতি ৩০ মিনিটে run_referral_retention() → এই রুট):
//   ১) X-Internal-Secret যাচাই (শুধু Supabase pg_cron থেকে কল হবে)
//   ২) referrals-এ status='pending' ও confirm_after (সাইন আপ + ২৪ ঘণ্টা) পার হওয়াগুলো আনা
//   ৩) প্রতিটার জন্য রেফার্ড ইউজারের android পুশ টোকেনে data-only ping:
//        • সব টোকেন আনইনস্টল চিহ্নিত / ping-এ not-registered → fail_referral('uninstalled_24h')
//        • প্রথম ping-এর পর ৩ ঘণ্টা অপেক্ষা (FCM আনইনস্টল দেরিতে ধরে), দ্বিতীয় ping-এ
//          অন্তত একটা টোকেন সচল → confirm_referral (১০০ পয়েন্ট)
//        • শুধু অন্য ধরনের এরর (অনিশ্চিত) হলে অপেক্ষা; দ্বিতীয় ping-এর ২৪ ঘণ্টা পরও
//          অনিশ্চিত থাকলে সন্দেহের সুবিধা দিয়ে confirm
//   ৪) পুশ টোকেন নেই (পারমিশন না দিলে): user_devices.last_seen দেখা —
//      confirm_after-এর পর অ্যাপ আবার খোলা হলে confirm; সাইন আপের ৭২ ঘণ্টা পরও না খুললে
//      fail_referral('not_returned')
//
// পয়েন্ট/স্ট্যাটাস বদল সব ডাটাবেজের confirm_referral()/fail_referral() RPC-তে
// (service role ছাড়া কেউ কল করতে পারে না)। ১০০ লিমিট ও ডিভাইস ডুপ্লিকেট চেকও সেখানে।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const ROUTE = '/api/referral/retention';

const HOUR = 60 * 60 * 1000;
const SECOND_PING_AFTER_MS = 3 * HOUR;
const NO_TOKEN_GIVE_UP_MS = 72 * HOUR;
const INCONCLUSIVE_CONFIRM_AFTER_MS = 24 * HOUR;
const FCM_BATCH = 500;
const MAX_PER_RUN = 200;

function getFirebaseAdmin() {
  if (getApps().length > 0) return getApp();

  const projectId = import.meta.env.FIREBASE_PROJECT_ID;
  const clientEmail = import.meta.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (import.meta.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  if (!projectId || !clientEmail || !privateKey) return null;

  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
}

// টোকেনগুলোতে data-only ping; কয়টা সফল, কোনগুলো আনইনস্টল (dead), বাকি এরর কয়টা
async function pingTokens(messaging, tokens: string[]) {
  let ok = 0;
  let other = 0;
  const dead: string[] = [];

  for (let i = 0; i < tokens.length; i += FCM_BATCH) {
    const chunk = tokens.slice(i, i + FCM_BATCH);
    const res = await messaging.sendEachForMulticast({
      tokens: chunk,
      data: { type: 'ping' },
      android: {
        priority: 'normal',
        ttl: 6 * HOUR,
        collapseKey: 'sf_ref_ping',
      },
    });

    res.responses.forEach((r, idx) => {
      if (r.success) {
        ok += 1;
        return;
      }
      const code = r.error?.code || '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        dead.push(chunk[idx]);
      } else {
        other += 1;
      }
    });
  }

  return { ok, other, dead };
}

async function markUninstalled(db, tokens: string[]) {
  if (!tokens.length) return;
  const nowIso = new Date().toISOString();
  for (let i = 0; i < tokens.length; i += 200) {
    await db
      .from('push_subscriptions')
      .update({ uninstalled_at: nowIso })
      .in('fcm_token', tokens.slice(i, i + 200))
      .is('uninstalled_at', null);
  }
}

async function confirmReferral(db, id: string) {
  const { error } = await db.rpc('confirm_referral', { p_ref_id: id });
  if (error) throw error;
}

async function failReferral(db, id: string, reason: string) {
  const { error } = await db.rpc('fail_referral', { p_ref_id: id, p_reason: reason });
  if (error) throw error;
}

// রিটার্ন: 'confirmed' | 'failed' | 'waiting'
async function evaluateRow(db, messaging, row, now: number) {
  const created = new Date(row.created_at).getTime();
  const confirmAfter = new Date(row.confirm_after).getTime();

  const { data: subs, error: subErr } = await db
    .from('push_subscriptions')
    .select('fcm_token, uninstalled_at')
    .eq('user_id', row.referred_user_id)
    .eq('platform', 'android')
    .not('fcm_token', 'is', null);
  if (subErr) throw subErr;

  const all = subs || [];
  const active = all.filter((s) => !s.uninstalled_at).map((s) => s.fcm_token);

  // পুশ টোকেন নেই → অ্যাপ আবার খোলা হয়েছে কিনা দিয়ে বিচার
  if (all.length === 0) {
    const { data: dev, error: devErr } = await db
      .from('user_devices')
      .select('last_seen')
      .eq('user_id', row.referred_user_id)
      .order('last_seen', { ascending: false })
      .limit(1);
    if (devErr) throw devErr;

    const lastSeen = dev && dev[0] ? new Date(dev[0].last_seen).getTime() : 0;
    if (lastSeen >= confirmAfter) {
      await confirmReferral(db, row.id);
      return 'confirmed';
    }
    if (now - created >= NO_TOKEN_GIVE_UP_MS) {
      await failReferral(db, row.id, 'not_returned');
      return 'failed';
    }
    return 'waiting';
  }

  // সব টোকেনই আনইনস্টল চিহ্নিত
  if (active.length === 0) {
    await failReferral(db, row.id, 'uninstalled_24h');
    return 'failed';
  }

  const stage = row.retention_stage || 0;

  // ধাপ ১: প্রথম ping (আনইনস্টল হলে FCM-কে জানার সুযোগ দেওয়া)
  if (stage === 0) {
    const r = await pingTokens(messaging, active);
    await markUninstalled(db, r.dead);

    if (r.ok === 0 && r.dead.length === active.length) {
      await failReferral(db, row.id, 'uninstalled_24h');
      return 'failed';
    }

    await db
      .from('referrals')
      .update({ retention_stage: 1, retention_ping_at: new Date(now).toISOString() })
      .eq('id', row.id)
      .eq('status', 'pending');
    return 'waiting';
  }

  // ধাপ ২: ৩ ঘণ্টা পর দ্বিতীয় ping — এটাই চূড়ান্ত
  const pingAt = row.retention_ping_at ? new Date(row.retention_ping_at).getTime() : now;
  if (now - pingAt < SECOND_PING_AFTER_MS) return 'waiting';

  const r2 = await pingTokens(messaging, active);
  await markUninstalled(db, r2.dead);

  if (r2.ok > 0) {
    await confirmReferral(db, row.id);
    return 'confirmed';
  }
  if (r2.dead.length === active.length) {
    await failReferral(db, row.id, 'uninstalled_24h');
    return 'failed';
  }
  // শুধু অনিশ্চিত এরর — আরও অপেক্ষা, তারপর সন্দেহের সুবিধা
  if (now - pingAt >= INCONCLUSIVE_CONFIRM_AFTER_MS) {
    await confirmReferral(db, row.id);
    return 'confirmed';
  }
  return 'waiting';
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

    const now = Date.now();
    const { data: rows, error } = await supabaseAdmin
      .from('referrals')
      .select('id, referred_user_id, created_at, confirm_after, retention_stage, retention_ping_at')
      .eq('status', 'pending')
      .lte('confirm_after', new Date(now).toISOString())
      .order('confirm_after', { ascending: true })
      .limit(MAX_PER_RUN);
    if (error) throw error;

    const stats = { checked: 0, confirmed: 0, failed: 0, waiting: 0, errors: 0 };
    const errorMessages: string[] = [];

    for (const row of rows || []) {
      stats.checked += 1;
      try {
        const result = await evaluateRow(supabaseAdmin, messaging, row, now);
        stats[result] += 1;
      } catch (err) {
        stats.errors += 1;
        if (errorMessages.length < 3) errorMessages.push(String((err as any)?.message || err));
      }
    }

    if (stats.errors > 0) {
      await reportServerError(reportDb, {
        route: ROUTE,
        action: 'referral_retention_row_failed',
        title: 'রেফার রিটেনশন: কিছু রেফার যাচাই করা যায়নি',
        message: errorMessages.join(' | '),
        status: 200,
      });
    }

    return json({ success: true, ...stats });
  } catch (err) {
    console.error('referral/retention এরর:', String(err));
    await reportServerError(reportDb, {
      route: ROUTE,
      action: 'referral_retention_unexpected',
      title: 'রেফার রিটেনশন: অপ্রত্যাশিত ক্র্যাশ',
      message: String(err),
      status: 500,
    });
    return json({ error: 'সার্ভার এরর' }, 500);
  }
}
