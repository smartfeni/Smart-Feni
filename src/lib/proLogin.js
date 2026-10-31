// ============================================================
// Smart Feni Pro — লগইন/লগআউট হেল্পার (/pro/login পেজের জন্য)
// নতুন অথ লজিক নয়: AuthModal.astro-র একই নিয়ম (ফোন → phone@smartfeni.local,
// ইমেইল দিলে profiles.recovery_email থেকে ফোন লুকআপ, পুরনো 88… ফলব্যাক,
// ব্লকড ইউজার ব্লক) এবং একই supabase সিঙ্গলটন।
// ⚠️ সাইটের মূল লগইন নিয়ম (AuthModal) বদলালে এই ফাইলও মেলাতে হবে।
// safeNext(): শুধু /pro দিয়ে শুরু হওয়া পাথে রিডাইরেক্ট (open-redirect সুরক্ষা)।
// ============================================================

import { supabase } from './supabase.js';

const LAST_ROLE_KEY = 'sf_pro_last_role';

// বাংলাদেশি নাম্বারের যেকোনো ফরম্যাট → 01XXXXXXXXX (AuthModal-এর মতো)
export function normalizeBdPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('880')) d = d.slice(2);
  if (d.length === 10 && d[0] === '1') d = '0' + d;
  return d;
}

function phoneToEmail(phone) {
  return normalizeBdPhone(phone) + '@smartfeni.local';
}

// next শুধু /pro, /pro/..., /pro?... বা /pro#... হলে মানা হবে; নইলে /pro
export function safeNext(next) {
  if (typeof next !== 'string') return '/pro';
  if (!/^\/pro(?:[\/?#]|$)/.test(next)) return '/pro';
  if (next.indexOf('\\') !== -1 || next.indexOf('//') !== -1) return '/pro';
  return next;
}

// ফলাফল: { ok: true } অথবা { ok: false, error: 'বাংলা বার্তা' }
export async function loginWithIdentifier(identifier, password) {
  const id = String(identifier || '').trim();
  if (!id || !password) return { ok: false, error: 'ফোন নম্বর/ইমেইল ও পাসওয়ার্ড দিন' };

  let loginEmail;
  if (id.indexOf('@') !== -1) {
    // ILIKE-র বিশেষ চিহ্ন (% _ \) এস্কেপ
    const pattern = id.replace(/[\\%_]/g, '\\$&');
    const { data: matches } = await supabase
      .from('profiles')
      .select('phone')
      .ilike('recovery_email', pattern)
      .limit(2);
    if (!matches || matches.length === 0) return { ok: false, error: 'এই ইমেইল দিয়ে কোনো একাউন্ট পাওয়া যায়নি' };
    if (matches.length > 1) return { ok: false, error: 'একাধিক একাউন্টে এই ইমেইল যুক্ত আছে, দয়া করে ফোন নাম্বার দিয়ে লগইন করুন' };
    loginEmail = phoneToEmail(matches[0].phone);
  } else {
    loginEmail = phoneToEmail(id);
  }

  let { data, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password });

  // পুরনো অ্যাকাউন্ট 88… ফরম্যাটে তৈরি — ফলব্যাক
  if (error && /^01\d{9}@smartfeni\.local$/.test(loginEmail)) {
    ({ data, error } = await supabase.auth.signInWithPassword({ email: '88' + loginEmail, password }));
  }
  if (error || !data || !data.user) {
    return { ok: false, error: 'লগইন ব্যর্থ: ফোন নাম্বার/ইমেইল অথবা পাসওয়ার্ড ভুল' };
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name, avatar_url, is_blocked')
    .eq('id', data.user.id)
    .single();

  if (profile && profile.is_blocked) {
    await supabase.auth.signOut();
    return { ok: false, error: 'আপনার একাউন্ট সাসপেন্ড করা হয়েছে। রিভিউ করার জন্য স্মার্ট ফেনী কাস্টমার কেয়ারে যোগাযোগ করুন।' };
  }

  // ডিলিটের অপেক্ষায় (গ্রেস পিরিয়ড) থাকলে Pro থেকে ঢুকতে দেওয়া হবে না
  try {
    const { data: del } = await supabase.rpc('get_my_deletion_status');
    if (del && del.pending) {
      await supabase.auth.signOut();
      return { ok: false, error: 'আপনার অ্যাকাউন্ট ডিলিটের অপেক্ষায় আছে। smartfeni.com-এ লগইন করে আগে ফিরিয়ে আনুন।' };
    }
  } catch (_) { /* স্ট্যাটাস চেক ব্যর্থ হলে স্বাভাবিক লগইন চলবে */ }

  try {
    window.dispatchEvent(new CustomEvent('smartfeni:auth-changed', {
      detail: { loggedIn: true, name: (profile && profile.full_name) || 'ইউজার', avatarUrl: (profile && profile.avatar_url) || '' },
    }));
  } catch (_) { /* উপেক্ষা */ }

  return { ok: true };
}

// পাসওয়ার্ড রিসেট লিংক (মূল ফর্মের মতোই /api/forgot-password)
export async function sendResetLink(phone) {
  try {
    const res = await fetch('/api/forgot-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: String(phone || '').trim() }),
    });
    let result = {};
    try { result = await res.json(); } catch (_) { /* উপেক্ষা */ }
    if (!res.ok) return { ok: false, error: result.error || 'কিছু একটা সমস্যা হয়েছে, আবার চেষ্টা করুন' };
    return { ok: true, message: result.message || 'রিসেট লিংক পাঠানো হয়েছে ✓' };
  } catch (_) {
    return { ok: false, error: 'নেটওয়ার্ক সমস্যা, আবার চেষ্টা করুন' };
  }
}

// লগআউট: হ্যামবার্গার মেনুর মতোই signOut + smartfeni:logged-out, তারপর Pro লগইনে
export async function proLogout() {
  try { await supabase.auth.signOut(); } catch (_) { /* উপেক্ষা */ }
  try { localStorage.removeItem(LAST_ROLE_KEY); } catch (_) { /* উপেক্ষা */ }
  try { window.dispatchEvent(new CustomEvent('smartfeni:logged-out')); } catch (_) { /* উপেক্ষা */ }
  window.location.replace('/pro/login');
}
