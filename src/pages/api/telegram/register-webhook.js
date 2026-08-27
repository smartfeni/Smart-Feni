// ============================================================
// API এন্ডপয়েন্ট: Telegram webhook রেজিস্ট্রেশন (একবারই চালাতে হবে)
// (/api/telegram/register-webhook) — deploy হওয়ার পর ব্রাউজারে এই
// URL ভিজিট করলেই Telegram-কে বলে দিবে কোথায় আপডেট পাঠাতে হবে।
// পরে আবার লাগবে না, শুধু bot token বদলালে বা প্রথমবার সেটআপে।
//
// ফিক্স: request.url থেকে origin বের করলে Vercel-এ মাঝে মাঝে
// ভুলভাবে "https://localhost" আসছিল (host header সমস্যা), তাই
// origin ডাইনামিক না করে সরাসরি প্রোডাকশন ডোমেইন hardcode করা হলো।
// ============================================================

export const prerender = false;

const SITE_URL = 'https://smartfeni.com';

export async function GET() {
  const token = process.env.TELEGRAM_HERO_BOT_TOKEN;

  if (!token) {
    return new Response(
      JSON.stringify({ error: 'TELEGRAM_HERO_BOT_TOKEN env var সেট করা নাই' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const webhookUrl = `${SITE_URL}/api/telegram/webhook`;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`
    );
    const data = await res.json();

    return new Response(
      JSON.stringify({ webhookUrl, telegramResponse: data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'রেজিস্ট্রেশন ব্যর্থ: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}