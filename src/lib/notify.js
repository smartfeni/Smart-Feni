// ============================================================
// শেয়ার্ড হেল্পার: user_notifications টেবিলে insert করার জন্য
// (ডেলিভারি/রাইড হিরো সিস্টেমের সব API endpoint এখান দিয়েই
// নোটিফিকেশন পাঠাবে)
//
// insert হলেই DB-তে বসানো trg_notify_push_on_insert ট্রিগার
// সাথে সাথে push notification পাঠিয়ে দিবে, আর
// NotificationDrawer.astro এর Realtime সাবস্ক্রিপশন ইন-অ্যাপ
// পপ-আপ দেখাবে — এখানে আলাদা করে push পাঠানোর কোনো কোড লাগে না,
// শুধু সঠিকভাবে রো insert করলেই হবে।
//
// ব্যবহারের জন্য service-role (admin) client লাগবে, কারণ
// user_notifications এ ইনসার্ট করার RLS পারমিশন সাধারণ ইউজারের
// নাই। প্রতিটা API endpoint এ deliverySupabase.js এর
// getAdminClient() থেকে পাওয়া client-টাই এখানে পাস করে দিলে হবে
// (নতুন client বানানোর দরকার নাই — যেটা আগে থেকে delivery_requests
// আপডেট করার জন্য বানানো হয়, সেটাই রিইউজ করব)।
// ============================================================

// একজন ইউজারকে একটা নোটিফিকেশন পাঠানো
export async function sendNotification(adminClient, {
  userId,
  message,
  category,
  actionUrl = null,
  relatedEntityType = null,
  relatedEntityId = null,
  senderType = 'system',
  senderId = null,
  linkLabel = null,
  priority = 'normal',
}) {
  if (!userId || !message || !category) {
    return { error: 'userId, message, category — এই তিনটা আবশ্যক' };
  }

  const { error } = await adminClient.from('user_notifications').insert({
    user_id: userId,
    message,
    category,
    action_url: actionUrl,
    related_entity_type: relatedEntityType,
    related_entity_id: relatedEntityId,
    sender_type: senderType,
    sender_id: senderId,
    link_label: linkLabel,
    priority,
    is_read: false,
    push_sent: false,
  });

  if (error) {
    // নোটিফিকেশন পাঠাতে ব্যর্থ হলেও মূল API রিকোয়েস্ট (যেমন accept/confirm)
    // ফেইল করা উচিত না — তাই caller-কে শুধু error জানিয়ে দিব, throw করব না
    console.error('নোটিফিকেশন পাঠাতে ব্যর্থ:', error.message);
    return { error: error.message };
  }

  return { error: null };
}

// একসাথে একাধিক ইউজারকে নোটিফিকেশন পাঠানো (যেমন: ম্যাচিং সব হিরোকে
// নতুন রিকোয়েস্টের কথা জানানো, বা হারা সব হিরোকে "deal closed" জানানো)
// payloadBuilder(userId) => { message, category, actionUrl, ... }
// — এতে প্রতিটা ইউজারের জন্য আলাদা মেসেজ টেক্সট দরকার হলে দেওয়া যায়
export async function sendBulkNotifications(adminClient, userIds, payloadBuilder) {
  const uniqueUserIds = [...new Set((userIds || []).filter(Boolean))];
  if (uniqueUserIds.length === 0) {
    return { error: null, sent: 0 };
  }

  const rows = uniqueUserIds.map((userId) => {
    const payload = payloadBuilder(userId);
    return {
      user_id: userId,
      message: payload.message,
      category: payload.category,
      action_url: payload.actionUrl ?? null,
      related_entity_type: payload.relatedEntityType ?? null,
      related_entity_id: payload.relatedEntityId ?? null,
      sender_type: payload.senderType ?? 'system',
      sender_id: payload.senderId ?? null,
      link_label: payload.linkLabel ?? null,
      priority: payload.priority ?? 'normal',
      is_read: false,
      push_sent: false,
    };
  });

  const { error } = await adminClient.from('user_notifications').insert(rows);

  if (error) {
    console.error('বাল্ক নোটিফিকেশন পাঠাতে ব্যর্থ:', error.message);
    return { error: error.message, sent: 0 };
  }

  return { error: null, sent: rows.length };
}
