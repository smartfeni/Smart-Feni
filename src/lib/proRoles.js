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
  rider: { label: 'রাইডার', sub: 'ডেলিভারি হিরো', icon: 'fa-motorcycle', href: '/delivery-hero' },
  shop: { label: 'অনলাইন শপ', sub: 'প্রোডাক্ট ও অর্ডার', icon: 'fa-store', href: '/my-shop' },
  club: { label: 'ক্লাব', sub: 'ক্লাব ম্যানেজমেন্ট', icon: 'fa-people-group', href: '/my-club' },
  clinic: { label: 'ক্লিনিক', sub: 'সিরিয়াল ও ডাক্তার', icon: 'fa-hospital', href: '/my-clinic' },
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

export function lastRole() {
  try { return localStorage.getItem(LAST_KEY); } catch (_) { return null; }
}

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
