// ============================================================
// API এন্ডপয়েন্ট: শপ-বট Telegram Webhook (/api/shop-telegram-webhook)
// এটা SmartFeniShopBoT এর জন্য (SHOP_TELEGRAM_BOT_TOKEN ব্যবহার করে) —
// আগে থেকে থাকা telegram-webhook.js (স্ক্রিনশট ইম্পোর্ট বট,
// TELEGRAM_BOT_TOKEN) থেকে সম্পূর্ণ আলাদা, কোনো সম্পর্ক নেই।
//
// কাজ: শপ ওউনার dashboard এর "Connect" বাটনে ক্লিক করলে
// /api/shop-telegram-connect-token থেকে এক-বার-ব্যবহারযোগ্য
// টোকেন নিয়ে t.me/SmartFeniShopBoT?start={token} এ যায়, Telegram এ
// /start চাপলে এই webhook এ মেসেজ আসে — টোকেন দিয়ে শপ খুঁজে
// chat_id বের করে shops.telegram_chat_id তে সেভ করে দেয়, আর
// token সাথে সাথে null করে দেয় (একবারই ব্যবহারযোগ্য)।
//
// আপডেট (সিকিউরিটি ফিক্স — Option B, one-time secret token):
// আগে এখানে সরাসরি shops.id (UUID) দিয়ে শপ খোঁজা হতো। যেহেতু শপের
// UUID public পেজে এক্সপোজড থাকে, যে কেউ সেটা দিয়ে /start করে
// অন্যের শপের নোটিফিকেশন হাইজ্যাক করতে পারত। এখন shops.id এর
// বদলে shops.telegram_connect_token (random, one-time) দিয়ে
// শপ খোঁজা হয়, আর ব্যবহারের পর token সাথে সাথে invalidate (null)
// করে দেওয়া হয়।
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
      const connectToken = parts[1]; // "/start <connectToken>" পেলোড

      if (!connectToken) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: 'এই বটটা স্মার্ট ফেনী শপ অর্ডার নোটিফিকেশনের জন্য। আপনার শপ ড্যাশবোর্ড থেকে "Telegram Connect" বাটনে ক্লিক করে আসুন।',
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // টোকেন দিয়ে শপ খোঁজা — shop UUID দিয়ে না
      const { data: shop, error: fetchError } = await supabase
        .from('shops')
        .select('id, name')
        .eq('telegram_connect_token', connectToken)
        .maybeSingle();

      if (fetchError || !shop) {
        await tg('sendMessage', {
          chat_id: chatId,
          text: '❌ এই লিংকটা মেয়াদোত্তীর্ণ বা অবৈধ — শপ ড্যাশবোর্ড থেকে আবার "Telegram Connect" বাটনে ক্লিক করে নতুন লিংক নিন।',
        });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      // chat_id সেভ করা + token সাথে সাথে invalidate (একবারই ব্যবহারযোগ্য)
      const { error: updateError } = await supabase
        .from('shops')
        .update({ telegram_chat_id: chatId, telegram_connect_token: null })
        .eq('id', shop.id);

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
