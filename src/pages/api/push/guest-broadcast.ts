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
//      বাদ — তারা নিজেদের ইনবক্সের পথেই পায়, দুইবার যাবে না
//   ৪) মৃত টোকেন (অ্যাপ আনইনস্টল ইত্যাদি) অটো মুছে যায়
//
// শুধু প্রমো: এখানে শুধু অফার/ঘোষণা যায়। ব্যক্তিগত বা সিকিউরিটি মেসেজ কখনো
// গেস্ট ডিভাইসে যায় না।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const HOUR = 60 * 60 * 1000;
const PROMO_CHANNEL = 'sf_promo_v1';
const BRAND_COLOR = '#FF6B35';
const GUEST_PROMO_TITLE = 'স্মার্ট ফেনী';
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

// পাতা করে সব সারি আনা (Supabase একবারে সর্বোচ্চ ১০০০)
async function fetchAll(supabaseAdmin, table: string, column: string) {
  const out: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from(table)
      .select(column)
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
  try {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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

    if (profile?.role !== 'admin') return json({ error: 'শুধু অ্যাডমিন পাঠাতে পারবেন' }, 403);

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

    if (promoError || !promoRow) return json({ error: 'প্রমো সেভ ব্যর্থ' }, 500);

    // ---------- ২) টার্গেট টোকেন (লগইন করা ডিভাইস বাদ) ----------
    const [guestTokens, loggedInTokens] = await Promise.all([
      fetchAll(supabaseAdmin, 'guest_push_devices', 'fcm_token'),
      fetchAll(supabaseAdmin, 'push_subscriptions', 'fcm_token'),
    ]);
    const loggedInSet = new Set(loggedInTokens);
    const targets = guestTokens.filter((t) => !loggedInSet.has(t));

    const firebaseApp = getFirebaseAdmin();
    if (!firebaseApp) {
      return json({ success: true, promo_id: promoRow.id, devices: targets.length, sent: 0, note: 'Firebase কনফিগার করা নেই — শুধু তালিকায় সেভ হয়েছে' });
    }

    // ---------- ৩) FCM পাঠানো ----------
    const messaging = getMessaging(firebaseApp);
    const shortBody = message.length > 300 ? message.slice(0, 297) + '...' : message;

    let sent = 0;
    let failed = 0;
    const staleTokens: string[] = [];

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
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/invalid-argument'
          ) {
            staleTokens.push(chunk[idx]);
          }
        }
      });
    }

    // ---------- ৪) মৃত টোকেন পরিষ্কার ----------
    for (let i = 0; i < staleTokens.length; i += 200) {
      await supabaseAdmin.from('guest_push_devices').delete().in('fcm_token', staleTokens.slice(i, i + 200));
    }

    return json({
      success: true,
      promo_id: promoRow.id,
      devices: targets.length,
      sent,
      failed,
      cleaned: staleTokens.length,
    });
  } catch (err) {
    console.error('guest-broadcast এরর:', String(err));
    return json({ error: 'সার্ভার এরর' }, 500);
  }
}
