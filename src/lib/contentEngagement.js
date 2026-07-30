// ============================================================
// শেয়ারড লজিক: লাইক টগল + অভিযোগ (রিপোর্ট) সাবমিট + কাউন্ট ফেচ
// যেকোনো কন্টেন্ট টাইপে কাজ করে (target_type: 'listing' | 'blood_profile' | 'blood_manual')
// ব্যবহার (পেজের <script>-এ):
//   import { fetchLikeData, toggleLike, submitReport, isLoggedIn } from '../../lib/contentEngagement.js';
//
// আপডেট: requireAuth() এখন সরাসরি window.openAuthModal() কল করে
// (AuthModal.astro-তে এটাই গ্লোবাল ওপেন ফাংশন হিসেবে এক্সপোজ করা আছে) —
// আলাদা কাস্টম ইভেন্ট লাগবে না।
// ============================================================

import { supabase } from './supabase.js';

/**
 * বর্তমানে কেউ লগইন করা আছে কিনা চেক করে।
 * @returns {Promise<boolean>}
 */
export async function isLoggedIn() {
  const { data: { user } } = await supabase.auth.getUser();
  return !!user;
}

/**
 * লগইন চেক করে। লগইন না থাকলে AuthModal খুলে দেয়।
 * @returns {Promise<object|null>} লগইন করা user অথবা null
 */
export async function requireAuth() {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('login');
    }
    return null;
  }
  return user;
}

/**
 * একগুচ্ছ target_id এর জন্য একবারে লাইক কাউন্ট + বর্তমান ইউজার
 * কোনগুলো লাইক করেছে তা ফেচ করে। লগইন না থাকলে likedByMe খালি থাকবে,
 * কিন্তু counts ঠিকই পাওয়া যাবে (ভিউ-অনলি প্রিভিউ এর জন্য)।
 * @param {string} targetType
 * @param {string[]} targetIds
 * @returns {Promise<{counts: Record<string, number>, likedByMe: Set<string>}>}
 */
export async function fetchLikeData(targetType, targetIds) {
  const counts = {};
  const likedByMe = new Set();
  if (!targetIds.length) return { counts, likedByMe };

  const { data: allLikes } = await supabase
    .from('content_likes')
    .select('target_id, user_id')
    .eq('target_type', targetType)
    .in('target_id', targetIds);

  (allLikes || []).forEach((row) => {
    counts[row.target_id] = (counts[row.target_id] || 0) + 1;
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    (allLikes || []).forEach((row) => {
      if (row.user_id === user.id) likedByMe.add(row.target_id);
    });
  }

  return { counts, likedByMe };
}

/**
 * লাইক টগল করে (আগে থেকে লাইক থাকলে তুলে নেয়, না থাকলে যোগ করে)।
 * লগইন না থাকলে AuthModal খুলে যাবে এবং { error: 'auth_required' } রিটার্ন করবে।
 * @param {string} targetType
 * @param {string} targetId
 * @returns {Promise<{liked: boolean}|{error: string}>}
 */
export async function toggleLike(targetType, targetId) {
  const user = await requireAuth();
  if (!user) return { error: 'auth_required' };

  const { data: existing } = await supabase
    .from('content_likes')
    .select('id')
    .eq('target_type', targetType)
    .eq('target_id', targetId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase.from('content_likes').delete().eq('id', existing.id);
    if (error) return { error: error.message };
    return { liked: false };
  } else {
    const { error } = await supabase
      .from('content_likes')
      .insert({ target_type: targetType, target_id: targetId, user_id: user.id });
    if (error) return { error: error.message };
    return { liked: true };
  }
}

/**
 * অভিযোগ (রিপোর্ট) সাবমিট করে — DB-এর RPC ফাংশন কল করে, যেটা
 * নিজেই কাউন্ট চেক করে ৩+ হলে অটো-ডিজেবল আর নোটিফিকেশন পাঠায়।
 * লগইন না থাকলে AuthModal খুলে যাবে।
 * @param {string} targetType
 * @param {string} targetId
 * @param {string} reasonCategory
 * @param {string} [reasonDetails]
 * @returns {Promise<{success: boolean, error?: string}>}
 */
export async function submitReport(targetType, targetId, reasonCategory, reasonDetails = null) {
  const user = await requireAuth();
  if (!user) return { success: false, error: 'auth_required' };

  const { error } = await supabase.rpc('submit_content_report', {
    p_target_type: targetType,
    p_target_id: targetId,
    p_reason_category: reasonCategory,
    p_reason_details: reasonDetails,
  });

  if (error) {
    // unique constraint violation মানে ইউজার আগেই রিপোর্ট করেছে
    if (error.code === '23505') return { success: false, error: 'already_reported' };
    return { success: false, error: error.message };
  }

  return { success: true };
}