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
//
// chat-images bucket এখন PRIVATE। DB-তে image_url আগের মতোই সেভ হয়
// (পুরনো public URL ফরম্যাট), কিন্তু দেখানোর সময় এই ফাইল signed URL
// বানিয়ে দেয় (storageSigned.js) — তাই UI কম্পোনেন্টে কিছু বদলাতে হয় না।
// ============================================================

import { supabase } from './supabase.js';
import { getSignedUrl } from './storageSigned.js';

const CHAT_BUCKET = 'chat-images';

// মেসেজ row-এর image_url কে signed URL দিয়ে বদলে দেয় (ছবি না থাকলে যেমন আছে তেমন)
async function withSignedImage(row) {
  if (!row || !row.image_url) return row;
  const signed = await getSignedUrl(supabase, CHAT_BUCKET, row.image_url);
  return { ...row, image_url: signed };
}

// একটা রিকোয়েস্টের সব মেসেজ আনা (পুরনো থেকে নতুন, সময়ক্রমে)
export async function getChatMessages(requestId, channel = 'rider') {
  let query = supabase
    .from('delivery_chat_messages')
    .select('id, request_id, sender_id, message, image_url, is_read, created_at, channel')
    .eq('request_id', requestId);
  // channel: 'rider' (ডিফল্ট, হিরো চ্যাট) | 'admin' (অ্যাডমিন ডিল চ্যাট) | 'all' (এডমিন রিভিউ)
  if (channel !== 'all') query = query.eq('channel', channel);
  const { data, error } = await query.order('created_at', { ascending: true });

  if (error) {
    return { data: [], error: error.message };
  }

  const signed = await Promise.all((data || []).map(withSignedImage));
  return { data: signed, error: null };
}

// নতুন মেসেজ পাঠানো — টেক্সট, ছবি, বা দুটোই একসাথে হতে পারে
// (কমপক্ষে একটা থাকতে হবে — DB constraint দিয়ে নিশ্চিত করা)
export async function sendChatMessage(requestId, message, imageUrl = null, channel = 'rider') {
  const trimmed = (message || '').trim();
  if (!trimmed && !imageUrl) {
    return { error: 'মেসেজ বা ছবি — অন্তত একটা দিতে হবে' };
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'লগইন করা নেই' };
  }

  const { error } = await supabase.from('delivery_chat_messages').insert({
    request_id: requestId,
    sender_id: user.id,
    message: trimmed || null,
    image_url: imageUrl,
    channel,
  });

  if (error) {
    return { error: error.message };
  }

  return { error: null };
}

// চ্যাট ছবি Supabase Storage-এ আপলোড করা (compressImage দিয়ে আগে
// থেকেই কম্প্রেস করা ফাইল আসবে বলে ধরে নেওয়া হচ্ছে — কলিং কোডে
// imageCompress.js ব্যবহার করা উচিত, payment-proof আপলোডের প্যাটার্নে)
//
// রিটার্ন:
//   url        → DB-তে সেভ করার মান (sendChatMessage-এ এটাই দেবে)
//   previewUrl → সাথে সাথে স্ক্রিনে দেখানোর signed URL (bucket private বলে
//                url সরাসরি <img>-এ কাজ করবে না)
export async function uploadChatImage(requestId, file) {
  const fileName = `${requestId}/${Date.now()}-${file.name}`;
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(CHAT_BUCKET)
    .upload(fileName, file);

  if (uploadError) {
    return { url: null, previewUrl: null, error: uploadError.message };
  }

  const { data: urlData } = supabase.storage.from(CHAT_BUCKET).getPublicUrl(uploadData.path);
  const previewUrl = await getSignedUrl(supabase, CHAT_BUCKET, uploadData.path);
  return { url: urlData.publicUrl, previewUrl, error: null };
}

// অন্য পক্ষের পাঠানো মেসেজগুলো "পড়া হয়েছে" মার্ক করা (চ্যাট খোলার সময় কল হবে)
export async function markMessagesRead(requestId, channel = 'rider') {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'লগইন করা নেই' };

  const { error } = await supabase
    .from('delivery_chat_messages')
    .update({ is_read: true })
    .eq('request_id', requestId)
    .eq('channel', channel)
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
// onInsert(row) কল হবে (row.image_url আগে থেকেই signed করা)। রিটার্ন হওয়া
// channel টা caller-কেই পরে supabase.removeChannel(channel) দিয়ে ক্লিন-আপ
// করতে হবে (মডাল বন্ধ হওয়ার সময়), নাহলে মেমরি লিক হবে।
export function subscribeToChatMessages(requestId, onInsert, msgChannel = 'rider') {
  const channel = supabase
    .channel(`delivery-chat-${requestId}-${msgChannel}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'delivery_chat_messages',
        filter: `request_id=eq.${requestId}`,
      },
      async (payload) => {
        // শুধু এই চ্যানেলের মেসেজ (rider / admin) দেখাবে
        if (msgChannel !== 'all' && (payload.new?.channel || 'rider') !== msgChannel) return;
        const row = await withSignedImage(payload.new);
        onInsert(row);
      }
    )
    .subscribe();

  return channel;
}