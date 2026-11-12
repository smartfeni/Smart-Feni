// path: src/lib/proRoles.js
// ============================================================
// Smart Feni Pro — রোল লোড ও মনে রাখা
// উৎস: RPC get_my_pro_roles() (সার্ভার-সাইড auth.uid(); UI শুধু রাউটিং, আসল সুরক্ষা RLS/RPC)
// রোল: rider | instant_shop | shop | club | clinic
// শেষ ব্যবহৃত রোল localStorage-এ (try/catch)
// ============================================================

import { supabase } from './supabase.js';

const LAST_KEY = 'sf_pro_last_role';

export const ROLE_META = {
  instant_shop: { label: 'ইনস্ট্যান্ট শপ', sub: 'অর্ডার গ্রহণ, রেডি, মেনু', icon: 'fa-utensils', href: '/pro/shop' },
  rider: { label: 'রাইডার', sub: 'ডেলিভারি হিরো', icon: 'fa-motorcycle', href: '/pro/hero' },
  shop: { label: 'অনলাইন শপ', sub: 'প্রোডাক্ট ও অর্ডার', icon: 'fa-store', href: '/pro/online-shop' },
  club: { label: 'ক্লাব', sub: 'ক্লাব ম্যানেজমেন্ট', icon: 'fa-people-group', href: '/pro/club' },
  clinic: { label: 'ক্লিনিক', sub: 'সিরিয়াল ও ডাক্তার', icon: 'fa-hospital', href: '/pro/clinic' },
  local_driver: { label: 'লোকাল ড্রাইভার', sub: 'সিএনজি/অটো রিকোয়েস্ট', icon: 'fa-van-shuttle', href: '/pro/local-ride' },
};

export async function getMyProRoles() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { loggedIn: false, roles: [] };
  const { data, error } = await supabase.rpc('get_my_pro_roles');
  if (error) return { loggedIn: true, roles: [], error: error.message };
  const roles = (Array.isArray(data) ? data : []).filter((r) => r && ROLE_META[r.role]);
  return { loggedIn: true, roles };
}

export function rememberRole(role) {
  try { localStorage.setItem(LAST_KEY, role); } catch (_) { /* উপেক্ষা */ }
}

// Pro লগইন পেজের লিংক (next শুধু /pro দিয়ে শুরু হলে লগইন পেজ মানবে)
export function proLoginUrl(next) {
  return '/pro/login' + (next ? '?next=' + encodeURIComponent(next) : '');
}

export function lastRole() {
  try { return localStorage.getItem(LAST_KEY); } catch (_) { return null; }
}

// ---------- কাজের ব্যাজ ----------
// RPC get_pro_badges() (auth.uid() ভিত্তিক): { total, roles:{ rider|instant_shop|shop|club|clinic: {open, active, shops?} } }
// ব্যর্থ হলে null (ব্যাজ লুকানো থাকবে)
export async function getProBadges() {
  try {
    const { data, error } = await supabase.rpc('get_pro_badges');
    if (error || !data) return null;
    return data;
  } catch (_) {
    return null;
  }
}

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
export function bnCount(n) {
  return n > 9 ? '৯+' : String(n).replace(/\d/g, (d) => BN_DIGITS[d]);
}

// counts = { open, active } → box-এ কমলা (কাজ বাকি) ও সবুজ (চলমান) চিপ; শূন্য হলে খালি
export function paintChips(box, counts) {
  if (!box) return;
  box.textContent = '';
  if (!counts) return;
  [['open', 'pbg-open', 'কাজ বাকি'], ['active', 'pbg-act', 'চলমান']].forEach(([k, cls, title]) => {
    const n = Number(counts[k]) || 0;
    if (n <= 0) return;
    const s = document.createElement('span');
    s.className = 'pbg-b ' + cls;
    s.textContent = bnCount(n);
    s.title = title;
    box.appendChild(s);
  });
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
