// path: src/lib/proHero.js
// ============================================================
// Smart Feni Pro — হিরো (রাইডার) ট্যাব নির্ধারণ
// delivery_riders.offers_delivery -> "ডিরেক্ট অর্ডার" + "অফলাইন অর্ডার"
// delivery_riders.offers_ride     -> "রাইড"
// UI শুধু রাউটিং; আসল সুরক্ষা প্রতিটা পেজের RLS/RPC-তে (auth.uid())।
// ============================================================

import { supabase } from './supabase.js';

const KEY = 'sf_pro_hero_tab';

export const HERO_TABS = {
  delivery: { label: 'ডিরেক্ট অর্ডার', icon: 'fa-bolt', href: '/pro/hero/delivery' },
  offline: { label: 'অফলাইন অর্ডার', icon: 'fa-clipboard-list', href: '/pro/hero/offline' },
  ride: { label: 'রাইড', icon: 'fa-motorcycle', href: '/pro/hero/ride' },
};

export async function getHeroTabs() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { loggedIn: false, hasRider: false, tabs: [] };
  const { data, error } = await supabase
    .from('delivery_riders')
    .select('id, offers_delivery, offers_ride')
    .eq('profile_id', session.user.id)
    .maybeSingle();
  if (error) return { loggedIn: true, hasRider: false, tabs: [], error: error.message };
  if (!data) return { loggedIn: true, hasRider: false, tabs: [] };
  const tabs = [];
  if (data.offers_delivery) tabs.push('delivery', 'offline');
  if (data.offers_ride) tabs.push('ride');
  if (!tabs.length) tabs.push('delivery');
  return { loggedIn: true, hasRider: true, tabs };
}

export function rememberHeroTab(tab) {
  try { localStorage.setItem(KEY, tab); } catch (_) { /* উপেক্ষা */ }
}

export function lastHeroTab() {
  try { return localStorage.getItem(KEY); } catch (_) { return null; }
}

// ট্যাব ব্যাজ: { rider, delivery:{open,active}, offline:{open,active}, ride:{open,active} }
// RPC get_pro_badges() (auth.uid() ভিত্তিক)। ব্যর্থ হলে null (ব্যাজ লুকানো থাকবে)
export async function getHeroBadges() {
  try {
    const { data, error } = await supabase.rpc('get_pro_badges');
    if (error || !data || !data.rider) return null;
    return data;
  } catch (_) {
    return null;
  }
}
