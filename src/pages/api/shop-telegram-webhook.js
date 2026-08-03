// ============================================================
// API এন্ডপয়েন্ট: শপ-বট Telegram Webhook (/api/shop-telegram-webhook)
// এটা SmartFeniShopBoT এর জন্য (SHOP_TELEGRAM_BOT_TOKEN ব্যবহার করে) —
// আগে থেকে থাকা telegram-webhook.js (স্ক্রিনশট ইম্পোর্ট বট,
// TELEGRAM_BOT_TOKEN) থেকে সম্পূর্ণ আলাদা, কোনো সম্পর্ক নেই।
//
// কাজ: শপ ওউনার dashboard এর "Connect" বাটনে ক্লিক করলে সে
// t.me/SmartFeniShopBoT?start={shopId} এ যায়, Telegram এ /start
// চাপলে এই webhook এ মেসেজ আসে — chat_id বের করে shops.telegram_chat_id
// তে সেভ করে দেয়।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const BOT_TOKEN = process.env.SHOP_TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function tg(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

export async function POST({ request }) {
  const update = await request.json();

  try {
    const message = update.message;
    if (message?.text?.startsWith('/start')) {
      const chatId = String(message.chat.id);
      const parts = message.text.trim().split(' ');
      const shopId = parts[1]; // "/start <shopId>" পেলোড

      if (!shopId) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: 'এই বটটা স্মার্ট ফেনী শপ অর্ডার নোটিফিকেশনের জন্য। আপনার শপ ড্যাশবোর্ড থেকে "Telegram Connect" বাটনে ক্লিক করে আসুন।',
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const { data: shop, error: fetchError } = await supabase
        .from('shops')
        .select('id, name')
        .eq('id', shopId)
        .maybeSingle();

      if (fetchError || !shop) {
        await tg('sendMessage', { chat_id: chatId, text: '❌ শপ খুঁজে পাওয়া যায়নি, লিংকটা আবার চেক করুন।' });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const { error: updateError } = await supabase
        .from('shops')
        .update({ telegram_chat_id: chatId })
        .eq('id', shopId);

      if (updateError) {
        await tg('sendMessage', { chat_id: chatId, text: `❌ কানেক্ট করতে সমস্যা হয়েছে: ${updateError.message}` });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      await tg('sendMessage', {
        chat_id: chatId,
        text: `✅ কানেক্টেড! এখন থেকে "${shop.name}" শপে নতুন অর্ডার এলেই এখানে নোটিফিকেশন পাবেন।`,
      });
    }
  } catch (err) {
    console.error('shop-telegram-webhook error:', err);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}