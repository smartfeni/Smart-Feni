// ============================================================
// API রুট: /api/health-request
// health.astro ফর্ম থেকে POST রিকোয়েস্ট এখানে আসবে।
// এই ফাংশন একসাথে ৩টা কাজ করে:
//   ১. Supabase-এর health_requests টেবিলে সেভ করে
//   ২. Resend দিয়ে ইমেইল নোটিফিকেশন পাঠায় (NOTIFY_EMAIL-এ)
//   ৩. Telegram Bot দিয়ে ইনস্ট্যান্ট মেসেজ পাঠায়
// legal-request.ts এর একই প্যাটার্ন — env var গুলোও একই (Resend/
// Telegram অ্যাকাউন্ট শেয়ার্ড, নতুন কিছু সেটআপ লাগে না)।
// ============================================================

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

const RESEND_API_KEY = import.meta.env.RESEND_API_KEY;
const NOTIFY_EMAIL = import.meta.env.NOTIFY_EMAIL;
const TELEGRAM_BOT_TOKEN = import.meta.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = import.meta.env.TELEGRAM_CHAT_ID;

async function sendEmail(data: { fullName: string; mobileNumber: string; problemDetails: string }) {
  if (!RESEND_API_KEY || !NOTIFY_EMAIL) {
    console.error('Resend env var মিসিং — RESEND_API_KEY বা NOTIFY_EMAIL সেট করা নাই');
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
        to: [NOTIFY_EMAIL],
        subject: `নতুন স্বাস্থ্য পরামর্শ অনুরোধ — ${data.fullName}`,
        html: `
          <h2>নতুন স্বাস্থ্য পরামর্শ অনুরোধ</h2>
          <p><strong>নাম:</strong> ${data.fullName}</p>
          <p><strong>মোবাইল:</strong> ${data.mobileNumber}</p>
          <p><strong>বিস্তারিত:</strong><br/>${data.problemDetails.replace(/\n/g, '<br/>')}</p>
        `,
      }),
    });

    const resBody = await res.text();

    if (!res.ok) {
      console.error(`Resend API এরর (status ${res.status}):`, resBody);
    } else {
      console.log('Resend ইমেইল পাঠানো সফল:', resBody);
    }
  } catch (err) {
    console.error('Resend fetch ব্যর্থ (নেটওয়ার্ক সমস্যা):', err);
  }
}

async function sendTelegram(data: { fullName: string; mobileNumber: string; problemDetails: string }) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.error('Telegram env var মিসিং — TELEGRAM_BOT_TOKEN বা TELEGRAM_CHAT_ID সেট করা নাই');
    return;
  }

  const text =
    `🩺 *নতুন স্বাস্থ্য পরামর্শ অনুরোধ*\n\n` +
    `👤 নাম: ${data.fullName}\n` +
    `📞 মোবাইল: ${data.mobileNumber}\n\n` +
    `📝 বিস্তারিত:\n${data.problemDetails}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'Markdown',
      }),
    });

    const resBody = await res.text();

    if (!res.ok) {
      console.error(`Telegram API এরর (status ${res.status}):`, resBody);
    }
  } catch (err) {
    console.error('Telegram fetch ব্যর্থ (নেটওয়ার্ক সমস্যা):', err);
  }
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { fullName, mobileNumber, problemDetails } = body;

    if (!fullName || !mobileNumber || !problemDetails) {
      return new Response(JSON.stringify({ error: 'সব ফিল্ড পূরণ করা আবশ্যক' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== ১. Supabase-এ সেভ =====
    const { error: dbError } = await supabase.from('health_requests').insert({
      full_name: fullName,
      mobile_number: mobileNumber,
      problem_details: problemDetails,
    });

    if (dbError) {
      console.error('Supabase সেভ এরর:', dbError.message);
      return new Response(JSON.stringify({ error: 'সাবমিট করতে সমস্যা হয়েছে, আবার চেষ্টা করুন' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // ===== ২ ও ৩. ইমেইল + টেলিগ্রাম — একসাথে, প্যারালালে পাঠানো =====
    const notifyData = { fullName, mobileNumber, problemDetails };
    await Promise.allSettled([sendEmail(notifyData), sendTelegram(notifyData)]);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('health-request API এরর:', err);
    return new Response(JSON.stringify({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};