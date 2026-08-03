// ============================================================
// API এন্ডপয়েন্ট: শপ-বট Webhook রেজিস্ট্রেশন (/api/shop-telegram-setup)
// একবার ব্রাউজারে ভিজিট করলেই Telegram এর কাছে জানিয়ে দেয় যে
// SmartFeniShopBoT এর updates এখন থেকে shop-telegram-webhook এ যাবে।
// একবার সফল হলে আর ভিজিট করার দরকার নেই (যতক্ষণ না বট টোকেন বদলায়)।
// ============================================================

export const prerender = false;

const BOT_TOKEN = process.env.SHOP_TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

export async function GET({ site }) {
  if (!BOT_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'SHOP_TELEGRAM_BOT_TOKEN env variable সেট করা নেই' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const siteUrl = site?.toString().replace(/\/$/, '') || 'https://smartfeni.com';
  const webhookUrl = `${siteUrl}/api/shop-telegram-webhook`;

  const res = await fetch(`${TELEGRAM_API}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: webhookUrl }),
  });

  const result = await res.json();

  return new Response(JSON.stringify({ webhookUrl, telegramResponse: result }, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}