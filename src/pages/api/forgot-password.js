// ============================================================
// API এন্ডপয়েন্ট: পাসওয়ার্ড রিসেট লিংক পাঠানো (/api/forgot-password)
// AuthModal.astro-এর "পাসওয়ার্ড ভুলে গেছেন?" ফর্ম থেকে কল হয়।
//
// flow:
// ১. ফোন নাম্বার থেকে ডামি auth ইমেইল বানানো (change-phone.js এর প্যাটার্ন)
// ২. supabase.auth.admin.generateLink({ type: 'recovery' }) দিয়ে
//    সিকিউর রিসেট টোকেন জেনারেট করা (এটা ইমেইল পাঠায় না, শুধু টোকেন দেয়)
// ৩. generateLink-এর রেসপন্স থেকে user.id বের করে profiles টেবিলে
//    recovery_email খোঁজা
// ৪. recovery_email থাকলে Resend দিয়ে রিসেট লিংক পাঠানো
// ৫. নিরাপত্তার জন্য — নাম্বার ভুল হোক বা রিকভারি ইমেইল না থাকুক,
//    সবসময় একই জেনেরিক success মেসেজ রিটার্ন হয় (enumeration ঠেকাতে)
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const SITE_URL = 'https://smartfeni.com';

const GENERIC_MESSAGE =
  'যদি এই ফোন নাম্বারে অ্যাকাউন্ট থাকে এবং রিকভারি ইমেইল সেট করা থাকে, একটা পাসওয়ার্ড রিসেট লিংক পাঠানো হয়েছে।';

async function sendResetEmail(toEmail, actionLink) {
  if (!RESEND_API_KEY) {
    console.error('Resend env var মিসিং — RESEND_API_KEY সেট করা নাই');
    return;
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Smart Feni <noreply@smartfeni.com>',
        to: [toEmail],
        subject: 'স্মার্ট ফেনী — পাসওয়ার্ড রিসেট করুন',
        html: `
          <h2>পাসওয়ার্ড রিসেট অনুরোধ</h2>
          <p>আপনার স্মার্ট ফেনী অ্যাকাউন্টের পাসওয়ার্ড রিসেট করার জন্য নিচের বাটনে ক্লিক করুন।</p>
          <p><a href="${actionLink}" style="display:inline-block;background:#FF6B35;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">পাসওয়ার্ড রিসেট করুন</a></p>
          <p>এই লিংকটি সীমিত সময়ের জন্য কার্যকর। যদি আপনি এই অনুরোধ না করে থাকেন, এই ইমেইলটি উপেক্ষা করুন।</p>
        `,
      }),
    });

    const resBody = await res.text();

    if (!res.ok) {
      console.error(`Resend API এরর (status ${res.status}):`, resBody);
    } else {
      console.log('পাসওয়ার্ড রিসেট ইমেইল পাঠানো সফল:', resBody);
    }
  } catch (err) {
    console.error('Resend fetch ব্যর্থ (নেটওয়ার্ক সমস্যা):', err);
  }
}

export async function POST({ request }) {
  try {
    const { phone } = await request.json();

    if (!phone) {
      return new Response(JSON.stringify({ error: 'ফোন নাম্বার দিন' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const digitsOnly = phone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return new Response(JSON.stringify({ error: 'সঠিক ফোন নম্বর দিন' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const dummyEmail = `${digitsOnly}@smartfeni.local`;

    // ===== ধাপ ১: রিকভারি টোকেন জেনারেট (এটাই existence check হিসেবেও কাজ করে) =====
    // আগে এখানে linkData.properties.action_link ব্যবহার হতো (Supabase-এর
    // নিজস্ব /auth/v1/verify এন্ডপয়েন্টের লিংক) — কিন্তু সেটাতে দুইটা সমস্যা
    // ছিল: (১) Gmail-এর মতো ইমেইল ক্লায়েন্টের লিংক-সেফটি-স্ক্যানার বট
    // ইউজার ক্লিক করার আগেই একবার visit করে ফেলতো, ফলে এক-বার-ব্যবহারযোগ্য
    // টোকেন আগেই খরচ হয়ে যেতো ("token not found" — লগে কনফার্ম করা হয়েছে)।
    // (২) কিছু মোবাইল ওয়েবভিউ/ইমেইল অ্যাপে রিডাইরেক্টের সময় URL hash
    // fragment (#access_token=...) হারিয়ে যায়। এখন বদলে hashed_token
    // ব্যবহার করে সরাসরি আমাদের নিজের reset-password পেজে ?token_hash=
    // query param দিয়ে লিংক পাঠানো হচ্ছে — পেজ লোড হওয়ার সময় শুধু স্ট্যাটিক
    // HTML দেখায় (তখনো কিছু verify হয় না), ইউজার আসলে ফর্ম দেখে JS চালু
    // হওয়ার পরই verifyOtp() কল হয় — তাই সাধারণ (non-JS) prefetch বট দিয়ে
    // টোকেন খরচ হয় না।
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: dummyEmail,
    });

    if (linkError || !linkData?.user || !linkData?.properties?.hashed_token) {
      console.error('generateLink ব্যর্থ (সম্ভবত এই নাম্বারে অ্যাকাউন্ট নাই):', linkError?.message);
      // নিরাপত্তার জন্য এখানেও একই জেনেরিক মেসেজ — ফাঁস করা হয় না যে নাম্বারটা ভুল
      return new Response(JSON.stringify({ success: true, message: GENERIC_MESSAGE }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== ধাপ ২: profiles থেকে recovery_email বের করা =====
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('recovery_email')
      .eq('id', linkData.user.id)
      .single();

    const recoveryEmail = profile?.recovery_email;
    const resetLink = `${SITE_URL}/reset-password?token_hash=${linkData.properties.hashed_token}&type=recovery`;

    if (recoveryEmail) {
      await sendResetEmail(recoveryEmail, resetLink);
    } else {
      console.error('রিকভারি ইমেইল সেট করা নাই এই ইউজারের জন্য:', linkData.user.id);
    }

    return new Response(JSON.stringify({ success: true, message: GENERIC_MESSAGE }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('forgot-password API এরর:', err);
    return new Response(JSON.stringify({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}