// ============================================================
// API এন্ডপয়েন্ট: অর্ডার নোটিফিকেশন পাঠানো (/api/shop-telegram-notify)
// checkout.astro থেকে প্রতিটা অর্ডার তৈরি হওয়ার পর কল হয়। শপের
// telegram_chat_id থাকলে (owner কানেক্ট করে থাকলে) সেই চ্যাটে
// কাস্টমারের তথ্য + প্রোডাক্ট লিস্ট সহ মেসেজ পাঠায়।
// chat_id না থাকলে চুপচাপ কিছু করে না (এরর দেয় না — অর্ডার তো
// dashboard এর Orders ট্যাবেই দেখা যাবে, Telegram শুধু extra push)।
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
  try {
    const { orderId } = await request.json();

    if (!orderId) {
      return new Response(JSON.stringify({ error: 'orderId আবশ্যক' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select('*, order_items(*), shops(name, telegram_chat_id)')
      .eq('id', orderId)
      .single();

    if (orderError || !order) {
      return new Response(JSON.stringify({ error: 'অর্ডার খুঁজে পাওয়া যায়নি' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    const chatId = order.shops?.telegram_chat_id;

    if (!chatId) {
      return new Response(JSON.stringify({ success: true, notified: false }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }

    const itemsText = (order.order_items || [])
      .map((it) => `• ${it.title} × ${it.quantity} — ৳${it.price || 0}`)
      .join('\n');

    const messageText = [
      `🛍️ নতুন অর্ডার এসেছে! (${order.shops?.name || 'শপ'})`,
      '',
      `👤 কাস্টমার: ${order.customer_name}`,
      `📞 ফোন: ${order.customer_phone}`,
      order.customer_address ? `📍 ঠিকানা: ${order.customer_address}` : null,
      '',
      '🧾 প্রোডাক্ট:',
      itemsText,
      '',
      'অর্ডার কনফার্ম করতে আপনার শপ ড্যাশবোর্ড → অর্ডার ট্যাবে যান।',
    ].filter(Boolean).join('\n');

    const tgResult = await tg('sendMessage', { chat_id: chatId, text: messageText });

    return new Response(JSON.stringify({ success: true, notified: true, telegramResponse: tgResult }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}