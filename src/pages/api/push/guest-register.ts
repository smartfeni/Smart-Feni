// path: src/pages/api/push/guest-register.ts
// ============================================================
// API: লগইন ছাড়া ইনস্টলড অ্যাপের FCM টোকেন সেভ (গেস্ট ডিভাইস)
//
// কেন: আগে push টোকেন শুধু লগইনের পরে /api/push/subscribe দিয়ে সেভ হতো
// (push_subscriptions.user_id বাধ্যতামূলক), তাই লগইন না করা অ্যাপে
// অ্যাডমিনের প্রমো পাঠানোর উপায় ছিল না। এখন অ্যাপ খুললে (ফোনে অনুমতি
// দেওয়া থাকলে) লগইন ছাড়াও টোকেন guest_push_devices টেবিলে সেভ হয়।
//
// নিরাপত্তা:
//   • টেবিলে কোনো RLS পলিসি নেই — শুধু এই সার্ভার রুট (service role) লেখে
//   • কোনো ইউজার আইডি/ব্যক্তিগত তথ্য নেওয়া হয় না, শুধু টোকেন
//   • টোকেনের ফরম্যাট ও দৈর্ঘ্য যাচাই; ভুয়া টোকেন FCM নিজেই ধরে ফেলবে এবং
//     guest-broadcast পাঠানোর সময় অটো মুছে যাবে
//   • টোকেন আগে থেকেই কোনো লগইন করা ইউজারের (push_subscriptions) হলে
//     গেস্ট তালিকায় ঢোকানো হয় না — একই ফোনে দুইবার প্রমো যাবে না
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export async function POST({ request }) {
  try {
    const raw = await request.text();
    if (!raw || raw.length > 8192) return json({ error: 'অবৈধ রিকোয়েস্ট' }, 400);

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'অবৈধ রিকোয়েস্ট' }, 400);
    }

    const token = body?.fcm_token;
    if (
      typeof token !== 'string' ||
      token.length < 20 ||
      token.length > 4096 ||
      !/^[A-Za-z0-9_:\-.]+$/.test(token)
    ) {
      return json({ error: 'অবৈধ টোকেন' }, 400);
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // লগইন করা ইউজারের টোকেন হলে গেস্ট হিসেবে রাখব না
    const { data: existingSub } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id')
      .eq('fcm_token', token)
      .limit(1)
      .maybeSingle();

    if (existingSub) return json({ success: true, skipped: 'logged_in_device' });

    const { error } = await supabaseAdmin
      .from('guest_push_devices')
      .upsert(
        { fcm_token: token, last_seen_at: new Date().toISOString() },
        { onConflict: 'fcm_token' }
      );

    if (error) return json({ error: 'সেভ ব্যর্থ' }, 500);

    return json({ success: true });
  } catch {
    return json({ error: 'সার্ভার এরর' }, 500);
  }
}
