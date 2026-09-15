// ============================================================
// API এন্ডপয়েন্ট: push subscription সেভ করা (/api/push/subscribe)
// ফাংশন: browser (VAPID endpoint+keys) অথবা native android app
//         (FCM token) থেকে পাওয়া push subscription
//         Supabase এর push_subscriptions টেবিলে সেভ করা
//
// নোট: প্রজেক্টের existing কনভেনশন অনুযায়ী (change-phone.js,
//       delete-user.js এর মতো) accessToken সরাসরি request body
//       তে পাঠানো হচ্ছে, cookie/header ভিত্তিক auth না।
//
// একই ইউজারের একাধিক ডিভাইস থাকতে পারে — endpoint/fcm_token UNIQUE
// constraint থাকায় upsert করলে ডুপ্লিকেট হবে না।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const body = await request.json();
    const { accessToken, platform = 'web', device_label } = body;

    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: 'accessToken আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (platform !== 'web' && platform !== 'android') {
      return new Response(
        JSON.stringify({ error: 'platform অবশ্যই web অথবা android হতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (platform === 'web') {
      const { endpoint, keys } = body;
      if (!endpoint || !keys?.p256dh || !keys?.auth) {
        return new Response(
          JSON.stringify({ error: 'web platform এর জন্য endpoint ও keys আবশ্যক' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      const { fcm_token } = body;
      if (!fcm_token) {
        return new Response(
          JSON.stringify({ error: 'android platform এর জন্য fcm_token আবশ্যক' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !anonKey) {
      return new Response(
        JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // caller-এর token দিয়ে identity যাচাই
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'ইউজার ভেরিফিকেশন ব্যর্থ' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    let upsertError;

    if (platform === 'web') {
      const { endpoint, keys } = body;
      // endpoint UNIQUE হওয়ায় upsert করলে একই ডিভাইস দ্বিতীয়বার সাবস্ক্রাইব করলে
      // পুরনো রেকর্ডটাই আপডেট হবে (last_used_at রিফ্রেশ), নতুন ডুপ্লিকেট তৈরি হবে না
      ({ error: upsertError } = await callerClient
        .from('push_subscriptions')
        .upsert(
          {
            user_id: callerUser.id,
            platform: 'web',
            endpoint,
            p256dh_key: keys.p256dh,
            auth_key: keys.auth,
            device_label: device_label || 'Unknown device',
            last_used_at: new Date().toISOString(),
          },
          { onConflict: 'endpoint' }
        ));
    } else {
      const { fcm_token } = body;
      // fcm_token UNIQUE হওয়ায় একই ডিভাইস দ্বিতীয়বার register করলে
      // পুরনো রেকর্ডটাই আপডেট হবে, নতুন ডুপ্লিকেট তৈরি হবে না
      ({ error: upsertError } = await callerClient
        .from('push_subscriptions')
        .upsert(
          {
            user_id: callerUser.id,
            platform: 'android',
            fcm_token,
            device_label: device_label || 'Android App',
            last_used_at: new Date().toISOString(),
          },
          { onConflict: 'fcm_token' }
        ));
    }

    if (upsertError) {
      return new Response(
        JSON.stringify({ error: 'সাবস্ক্রিপশন সেভ করতে ব্যর্থ', details: upsertError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'সার্ভার এরর', details: String(err) }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
