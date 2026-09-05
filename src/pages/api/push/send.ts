// ============================================================
// API এন্ডপয়েন্ট: আসল push notification পাঠানো (/api/push/send)
// ফাংশন: Supabase এর dispatch_pending_push_notifications() cron
//         থেকে (pg_net এর মাধ্যমে) কল হয় — এখানে সেই ইউজারের
//         সব ডিভাইসে (একাধিক হতে পারে) আসল push পাঠানো হয়
//
// নিরাপত্তা: X-Internal-Secret হেডার যাচাই করা হয় — শুধু
// Supabase cron থেকেই কল আসার কথা, বাইরের কেউ কল করলে 401 পাবে
//
// Stale subscription cleanup: 404/410 রেসপন্স এলে (মানে ব্রাউজার/
// ডিভাইসে সাবস্ক্রিপশন আর ভ্যালিড না) সেই রেকর্ড ডিলিট করা হয়
// ============================================================

import { createClient } from '@supabase/supabase-js';
import webpush from 'web-push';

export const prerender = false;

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

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const { data: subscriptions, error: fetchError } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh_key, auth_key')
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

    const payload = JSON.stringify({
      notification_id,
      title,
      body,
      category,
      image_url,
      action_url,
    });

    let sentCount = 0;
    const staleSubscriptionIds = [];

    // ইউজারের একাধিক ডিভাইসে (একাধিক subscription) সমান্তরালে পাঠানো
    await Promise.all(
      subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
            },
            payload
          );
          sentCount++;
        } catch (err) {
          // 404/410 মানে এই সাবস্ক্রিপশন আর ভ্যালিড না (ব্রাউজার আনইনস্টল/ডেটা ক্লিয়ার ইত্যাদি)
          if (err.statusCode === 404 || err.statusCode === 410) {
            staleSubscriptionIds.push(sub.id);
          }
          // অন্য এরর (যেমন সাময়িক নেটওয়ার্ক সমস্যা) সাইলেন্টলি স্কিপ, পরের নোটিফিকেশনে আবার ট্রাই হবে
        }
      })
    );

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