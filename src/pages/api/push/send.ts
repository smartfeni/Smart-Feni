// ============================================================
// API এন্ডপয়েন্ট: আসল push notification পাঠানো (/api/push/send)
// ফাংশন: Supabase এর dispatch_pending_push_notifications() cron
//         থেকে (pg_net এর মাধ্যমে) কল হয় — এখানে সেই ইউজারের
//         সব ডিভাইসে (web + android, একাধিক হতে পারে) আসল push পাঠানো হয়
//
// আপডেট (নেটিভ পার্মিশন প্রজেক্ট): dual-send —
//         platform === 'web'     → web-push (VAPID)
//         platform === 'android' → firebase-admin (FCM)
//
// নিরাপত্তা: X-Internal-Secret হেডার যাচাই করা হয় — শুধু
// Supabase cron থেকেই কল আসার কথা, বাইরের কেউ কল করলে 401 পাবে
//
// Stale subscription cleanup:
//   - web: 404/410 রেসপন্স এলে রেকর্ড ডিলিট
//   - android: FCM 'messaging/registration-token-not-registered' বা
//     'messaging/invalid-registration-token' এলে রেকর্ড ডিলিট
// ============================================================

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';
import { initializeApp, cert, getApps, getApp } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';

export const prerender = false;

// Firebase Admin singleton — serverless function বারবার cold-start
// হলেও একই process এ multiple init এড়াতে চেক করা হয়
//
// নোট: `import admin from 'firebase-admin'` (namespace-style import) Vercel এর
// serverless bundler এ ESM/CJS interop সমস্যা করে (admin.credential undefined
// হয়ে যায়) — তাই এখানে firebase-admin/app ও firebase-admin/messaging থেকে
// সরাসরি (modular) ফাংশন import করা হচ্ছে, যেটা bundler-safe।
function getFirebaseAdmin() {
  if (getApps().length > 0) {
    return getApp();
  }

  const projectId = import.meta.env.FIREBASE_PROJECT_ID;
  const clientEmail = import.meta.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (import.meta.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');

  if (!projectId || !clientEmail || !privateKey) {
    return null;
  }

  return initializeApp({
    credential: cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

export async function POST({ request }) {
  try {
    const internalSecret = request.headers.get('X-Internal-Secret');
    const expectedSecret = import.meta.env.PUSH_INTERNAL_SECRET;

    if (!expectedSecret || internalSecret !== expectedSecret) {
      return new Response(
        JSON.stringify({ error: 'unauthorized' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { notification_id, user_id, title, body, category, image_url, action_url } = await request.json();

    if (!user_id || !title) {
      return new Response(
        JSON.stringify({ error: 'user_id ও title আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    const vapidPublicKey = import.meta.env.PUSH_KEY_PUBLIC;
    const vapidPrivateKey = import.meta.env.VAPID_PRIVATE_KEY;
    const vapidSubject = import.meta.env.VAPID_SUBJECT || 'mailto:info@smartfeni.com';

    if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey) {
      return new Response(
        JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

    const firebaseApp = getFirebaseAdmin();

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, platform, endpoint, p256dh_key, auth_key, fcm_token')
      .eq('user_id', user_id);

    if (fetchError) {
      return new Response(
        JSON.stringify({ error: 'সাবস্ক্রিপশন খুঁজতে ব্যর্থ', details: fetchError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ success: true, sent: 0, note: 'কোনো ডিভাইস সাবস্ক্রাইব করা নেই' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const webSubs = subscriptions.filter((s) => s.platform === 'android' ? false : true);
    const androidSubs = subscriptions.filter((s) => s.platform === 'android');

    let sentCount = 0;
    const staleSubscriptionIds = [];

    // ---------- Web (VAPID) ----------
    const webPayload = JSON.stringify({
      notification_id,
      title,
      body,
      category,
      image_url,
      action_url,
    });

    await Promise.all(
      webSubs.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
            },
            webPayload
          );
          sentCount++;
        } catch (err) {
          // 404/410 মানে এই সাবস্ক্রিপশন আর ভ্যালিড না (ব্রাউজার/ডিভাইসে ডেটা ক্লিয়ার ইত্যাদি)
          if (err.statusCode === 404 || err.statusCode === 410) {
            staleSubscriptionIds.push(sub.id);
          }
          // অন্য এরর (যেমন সাময়িক নেটওয়ার্ক সমস্যা) সাইলেন্টলি স্কিপ, পরের নোটিফিকেশনে আবার ট্রাই হবে
        }
      })
    );

    // ---------- Android (FCM) ----------
    if (androidSubs.length > 0 && firebaseApp) {
      const messaging = getMessaging(firebaseApp);

      await Promise.all(
        androidSubs.map(async (sub) => {
          try {
            await messaging.send({
              token: sub.fcm_token,
              notification: {
                title,
                body: body || '',
                imageUrl: image_url || undefined,
              },
              data: {
                notification_id: notification_id ? String(notification_id) : '',
                category: category || '',
                action_url: action_url || '',
              },
              android: {
                priority: 'high',
              },
            });
            sentCount++;
          } catch (err) {
            const code = err?.errorInfo?.code || err?.code || '';
            if (
              code === 'messaging/registration-token-not-registered' ||
              code === 'messaging/invalid-registration-token'
            ) {
              staleSubscriptionIds.push(sub.id);
            }
            // অন্য এরর সাইলেন্টলি স্কিপ, পরের নোটিফিকেশনে আবার ট্রাই হবে
          }
        })
      );
    }

    if (staleSubscriptionIds.length > 0) {
      await supabaseAdmin.from('push_subscriptions').delete().in('id', staleSubscriptionIds);
    }

    return new Response(
      JSON.stringify({ success: true, sent: sentCount, cleaned: staleSubscriptionIds.length }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'সার্ভার এরর', details: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
