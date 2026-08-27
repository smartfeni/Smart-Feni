// ============================================================
// API এন্ডপয়েন্ট: Telegram webhook
// (/api/telegram/webhook) — @Smart_hero_bot এর সব আপডেট এখানে আসবে
//
// ফ্লো: ইউজার প্রোফাইল/ড্যাশবোর্ড থেকে
// https://t.me/Smart_hero_bot?start=<profile_id> লিংকে ক্লিক করে
// বট চ্যাট খুলবে, /start <profile_id> কমান্ড অটো পাঠাবে, Telegram
// সেটা এই webhook-এ ফরওয়ার্ড করবে — আমরা profile_id ভ্যালিডেট করে
// profiles.telegram_chat_id সেট করে দিব।
//
// নিরাপত্তা নোট: profile_id (UUID) অনুমান করা প্র্যাক্টিক্যালি অসম্ভব,
// তাই আলাদা এককালীন কোড ছাড়াই সরাসরি UUID পেলোড হিসেবে ব্যবহার
// নিরাপদ (অনেক বট এই প্যাটার্নই ব্যবহার করে)।
// ============================================================

import { getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendTelegramMessage } from '../../../lib/telegramNotify.js';

export const prerender = false;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST({ request }) {
  try {
    const update = await request.json();
    const message = update.message;

    if (!message || !message.text) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const chatId = message.chat.id;
    const text = message.text.trim();

    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const profileId = parts[1];

      if (!profileId || !UUID_REGEX.test(profileId)) {
        await sendTelegramMessage(
          chatId,
          'স্বাগতম! সরাসরি এই বট থেকে চালু করবেন না — অ্যাপের প্রোফাইল/ড্যাশবোর্ড থেকে "Telegram নোটিফিকেশন চালু করুন" বাটনে ক্লিক করুন।'
        );
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const { client: adminClient, error: adminError } = getAdminClient();
      if (adminError) {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      const { data: profile } = await adminClient
        .from('profiles')
        .select('id, full_name')
        .eq('id', profileId)
        .maybeSingle();

      if (!profile) {
        await sendTelegramMessage(chatId, 'দুঃখিত, প্রোফাইল খুঁজে পাওয়া যায়নি। অ্যাপ থেকে আবার চেষ্টা করুন।');
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }

      await adminClient
        .from('profiles')
        .update({ telegram_chat_id: chatId })
        .eq('id', profileId);

      await sendTelegramMessage(
        chatId,
        `✅ ধন্যবাদ ${profile.full_name || ''}! Telegram নোটিফিকেশন চালু হয়ে গেছে — নতুন রিকোয়েস্ট এলে এখানেই জানানো হবে।`
      );
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    // Telegram-কে সবসময় 200 রিটার্ন করা ভালো, নাহলে বারবার retry করবে
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
}
