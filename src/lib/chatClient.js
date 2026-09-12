// ============================================================
// ডেলিভারি/রাইড হিরো ইন-অ্যাপ চ্যাট — কাস্টমার ও accepted হিরোর
// মধ্যে (WhatsApp-এর বিকল্প)
//
// RLS নিজেই নিশ্চিত করে শুধু ওই রিকোয়েস্টের কাস্টমার আর accepted
// রাইডারই পড়তে/লিখতে পারবে (is_delivery_chat_participant()) —
// তাই এখানে সরাসরি `supabase` (client-side, RLS-scoped) ব্যবহার
// করা হচ্ছে, কোনো API endpoint বা admin client লাগছে না।
//
// নতুন মেসেজ insert হলে DB ট্রিগার (trg_notify_chat_message) অটো
// user_notifications এ ইনসার্ট করে দেয়, যেটা আবার push notification
// ট্রিগার (trg_notify_push_on_insert) চালু করে দেয় — তাই এখানে
// আলাদা করে নোটিফিকেশন পাঠানোর কোনো কোড লাগে না।
// ============================================================

import { supabase } from './supabase.js';

// একটা রিকোয়েস্টের সব মেসেজ আনা (পুরনো থেকে নতুন, সময়ক্রমে)
export async function getChatMessages(requestId) {
  const { data, error } = await supabase
    .from('delivery_chat_messages')
    .select('id, request_id, sender_id, message, is_read, created_at')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });

  if (error) {
    return { data: [], error: error.message };
  }

  return { data: data || [], error: null };
}

// নতুন মেসেজ পাঠানো
export async function sendChatMessage(requestId, message) {
  const trimmed = (message || '').trim();
  if (!trimmed) {
    return { error: 'মেসেজ খালি রাখা যাবে না' };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'লগইন করা নেই' };
  }

  const { error } = await supabase.from('delivery_chat_messages').insert({
    request_id: requestId,
    sender_id: user.id,
    message: trimmed,
  });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

// অন্য পক্ষের পাঠানো মেসেজগুলো "পড়া হয়েছে" মার্ক করা (চ্যাট খোলার সময় কল হবে)
export async function markMessagesRead(requestId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'লগইন করা নেই' };

  const { error } = await supabase
    .from('delivery_chat_messages')
    .update({ is_read: true })
    .eq('request_id', requestId)
    .neq('sender_id', user.id)
    .eq('is_read', false);

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

// একটা রিকোয়েস্টে অন্য পক্ষের কতগুলো মেসেজ এখনো "পড়া হয়নি" —
// চ্যাট বাটনে আনরিড ব্যাজ দেখানোর জন্য
export async function getUnreadCount(requestId) {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 0;

  const { count } = await supabase
    .from('delivery_chat_messages')
    .select('id', { count: 'exact', head: true })
    .eq('request_id', requestId)
    .neq('sender_id', user.id)
    .eq('is_read', false);

  return count || 0;
}

// একটা রিকোয়েস্টের চ্যাটে রিয়েলটাইম সাবস্ক্রাইব করা — নতুন মেসেজ এলে
// onInsert(row) কল হবে। রিটার্ন হওয়া channel টা caller-কেই পরে
// supabase.removeChannel(channel) দিয়ে ক্লিন-আপ করতে হবে (মডাল বন্ধ
// হওয়ার সময়), নাহলে মেমরি লিক হবে।
export function subscribeToChatMessages(requestId, onInsert) {
  const channel = supabase
    .channel(`delivery-chat-${requestId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'delivery_chat_messages',
        filter: `request_id=eq.${requestId}`,
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe();

  return channel;
}
