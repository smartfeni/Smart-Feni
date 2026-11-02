// path: src/lib/proInbox.js
// ============================================================
// Smart Feni Pro — আলাদা নোটিফিকেশন ইনবক্স (user_notifications থেকে শুধু Pro-সংক্রান্ত)
// Pro নোটিফিকেশন চেনা হয় action_url দেখে — send.ts-এর PRO_URL_RE-র সাথে মিলিয়ে রাখতে হবে:
//   /pro, /pro/*, /delivery-hero, /ride-hero, /offline-orders, /my-shop, /my-club, /my-clinic
// (ক্যাটাগরি দিয়ে নয়: delivery_hero/message কাস্টমারকেও যায়, তাদের লিংক /my-orders)
// সুরক্ষা RLS-এ (নিজের রো); এখানে .eq('user_id') অতিরিক্ত।
// মেইন অ্যাপের ইনবক্স (NotificationDrawer) অপরিবর্তিত, ধাপ চ-তে মেইন থেকে Pro অংশ সরবে।
// ============================================================

import { supabase } from './supabase.js';
import { proPath } from './proApp.js';

const OR_FILTER = [
  'action_url.like./pro/*',
  'action_url.eq./pro',
  'action_url.like./delivery-hero*',
  'action_url.like./ride-hero*',
  'action_url.like./offline-orders*',
  'action_url.like./my-shop*',
  'action_url.like./my-club*',
  'action_url.like./my-clinic*',
].join(',');

const PRO_URL_RE = /^\/(pro|delivery-hero|ride-hero|offline-orders|my-shop|my-club|my-clinic)(?:[/?#]|$)/;

export function isProUrl(actionUrl) {
  return typeof actionUrl === 'string' && PRO_URL_RE.test(actionUrl);
}

// নোটিফিকেশনের লিংক -> Pro অ্যাপের পেজ (শুধু নিজের সাইটের লিংক; নইলে null)
export function proUrlFor(actionUrl) {
  try {
    if (!actionUrl) return null;
    const u = new URL(actionUrl, window.location.origin);
    if (u.origin !== window.location.origin) return null;
    return proPath(u.pathname) + u.search;
  } catch (_) {
    return null;
  }
}

async function uid() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? session.user.id : null;
}

export async function fetchProNotifications(limit = 60) {
  const id = await uid();
  if (!id) return { loggedIn: false, items: [] };
  const { data, error } = await supabase
    .from('user_notifications')
    .select('id, message, category, action_url, is_read, created_at, priority, image_url')
    .eq('user_id', id)
    .or(OR_FILTER)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) return { loggedIn: true, items: [], error: error.message };
  return { loggedIn: true, items: data || [] };
}

export async function countProUnread() {
  const id = await uid();
  if (!id) return 0;
  const { count, error } = await supabase
    .from('user_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', id)
    .eq('is_read', false)
    .or(OR_FILTER);
  if (error) return 0;
  return count || 0;
}

export async function markRead(notifId) {
  if (!notifId) return;
  await supabase.from('user_notifications').update({ is_read: true }).eq('id', notifId);
  window.dispatchEvent(new CustomEvent('smartfeni:pro-notif-changed'));
}

export async function markAllRead() {
  const id = await uid();
  if (!id) return;
  await supabase
    .from('user_notifications')
    .update({ is_read: true })
    .eq('user_id', id)
    .eq('is_read', false)
    .or(OR_FILTER);
  window.dispatchEvent(new CustomEvent('smartfeni:pro-notif-changed'));
}

// নতুন নোটিফিকেশন এলে onChange(newRow) ডাকে (শুধু Pro-সংক্রান্ত হলে); ফেরত দেয় বন্ধ করার ফাংশন
export function subscribeProInbox(userId, onChange) {
  if (!userId) return () => {};
  const ch = supabase
    .channel('pro_inbox_' + userId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'user_notifications', filter: 'user_id=eq.' + userId },
      (payload) => {
        const row = payload && payload.new;
        if (row && isProUrl(row.action_url)) onChange(row);
      }
    )
    .subscribe();
  return () => { try { supabase.removeChannel(ch); } catch (_) { /* উপেক্ষা */ } };
}
