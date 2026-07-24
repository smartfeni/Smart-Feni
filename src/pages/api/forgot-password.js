// ============================================================
// API এন্ডপয়েন্ট: পাসওয়ার্ড রিসেট লিংক পাঠানো (/api/forgot-password)
// AuthModal.astro-এর "পাসওয়ার্ড ভুলে গেছেন?" ফর্ম থেকে কল হয়।
//
// flow:
// ১. ফোন নাম্বার থেকে ডামি auth ইমেইল বানানো (change-phone.js এর প্যাটার্ন)
// ২. supabase.auth.admin.generateLink({ type: 'recovery' }) দিয়ে
//    সিকিউর রিসেট লিংক জেনারেট করা (এটা ইমেইল পাঠায় না, শুধু লিংক দেয়)
// ৩. generateLink-এর রেসপন্স থেকে user.id বের করে profiles টেবিলে
//    recovery_email খোঁজা
// ৪. recovery_email থাকলে Resend দিয়ে সেই লিংক পাঠানো
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
        from: 'Smart Feni <onboarding@resend.dev>',
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

    // ===== ধাপ ১: রিকভারি লিংক জেনারেট (এটাই existence check হিসেবেও কাজ করে) =====
    const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: 'recovery',
      email: dummyEmail,
      options: { redirectTo: `${SITE_URL}/reset-password` },
    });

    if (linkError || !linkData?.user) {
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
    const actionLink = linkData.properties?.action_link;

    if (recoveryEmail && actionLink) {
      await sendResetEmail(recoveryEmail, actionLink);
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