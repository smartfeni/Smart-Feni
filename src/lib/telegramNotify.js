// ============================================================
// লাইব্রেরি: Telegram Bot API হেল্পার (সার্ভার-সাইড, শুধু API রুট
// থেকে ইমপোর্ট হবে — TELEGRAM_HERO_BOT_TOKEN env var-এ টোকেন লাগবে)
//
// বট: @Smart_hero_bot — Delivery Hero / Ride Hero নোটিফিকেশনের
// জন্য আলাদা বট, existing shop-orders বট থেকে স্বতন্ত্র।
// ============================================================

const BOT_TOKEN = import.meta.env.TELEGRAM_HERO_BOT_TOKEN;

export async function sendTelegramMessage(chatId, text) {
  if (!BOT_TOKEN) {
    console.error('TELEGRAM_HERO_BOT_TOKEN সেট করা নেই');
    return { error: 'বট টোকেন কনফিগার করা নাই' };
  }
  if (!chatId) {
    return { error: 'chatId নাই' };
  }

  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    });
    const data = await res.json();
    if (!data.ok) {
      return { error: data.description || 'Telegram API এরর' };
    }
    return { success: true };
  } catch (err) {
    return { error: 'Telegram রিকোয়েস্ট ব্যর্থ: ' + err.message };
  }
}

// একসাথে একাধিক chat_id-তে পাঠানো (fire-and-forget style, একটা ব্যর্থ
// হলেও বাকিগুলো চেষ্টা করবে) — নতুন রিকোয়েস্ট বা losing-hero
// নোটিফিকেশনের জন্য ব্যবহার হবে
export async function sendTelegramBroadcast(chatIds, text) {
  const validIds = (chatIds || []).filter(Boolean);
  await Promise.allSettled(validIds.map((id) => sendTelegramMessage(id, text)));
}
