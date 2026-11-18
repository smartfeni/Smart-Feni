// path: src/lib/marketApi.js
// ============================================================
// মার্কেটপ্লেস (ব্রান্চ: marketplace) — ধাপ ২: শুধু পড়ার ফাংশন।
// - fetchMarketCategories(): সক্রিয় ক্যাটাগরি (delivery_market_categories)
// - fetchMarketShops(): delivery_shops থেকে কাস্টমারকে দেখানোর মতো দোকান
//   (RLS: সবাই শুধু is_active দেখে; delivery_shops.view পারমিশনওয়ালা স্টাফ টেস্ট শপও দেখে)
// - shopOpenState(): খোলা/বন্ধ/ব্যস্ত/ছুটি, সব হিসাব ঢাকার সময়ে (UTC+6)
// ============================================================
import { supabase } from './supabase.js';

const DHAKA_MS = 6 * 60 * 60 * 1000;

export async function fetchMarketCategories() {
  const { data, error } = await supabase
    .from('delivery_market_categories')
    .select('id, slug, name, icon, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function fetchMarketShops() {
  const { data, error } = await supabase
    .from('delivery_shops')
    .select('id, name, image_url, upazila, union_name, address, lat, lng, is_popular, is_open, busy_until, market_category_ids, prep_minutes, opens_at, closes_at, weekly_off, sort_order, is_test, is_active')
    .order('is_popular', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  // দেখানো হবে: সক্রিয় দোকান, অথবা (শুধু স্টাফ যা পায়) টেস্ট দোকান। ম্যাপ পিন ছাড়া দোকান দেখানো হবে না।
  return (data || []).filter((s) => (s.is_active || s.is_test) && s.lat !== null && s.lng !== null);
}

// সার্চ ও খাবারের ধরন ফিল্টারের জন্য আইটেমের নাম (দোকান পিছু)। ফেরত: { [shop_id]: 'নাম ট্যাগ ...' (ছোট হাতের) }
export async function fetchMarketItemIndex() {
  const { data, error } = await supabase
    .from('delivery_shop_items')
    .select('shop_id, name, tags')
    .eq('is_available', true)
    .limit(5000);
  if (error) throw error;
  const idx = {};
  (data || []).forEach((it) => {
    const t = [it.name || ''].concat(Array.isArray(it.tags) ? it.tags : []).join(' ').toLowerCase();
    idx[it.shop_id] = (idx[it.shop_id] ? idx[it.shop_id] + ' ' : '') + t;
  });
  return idx;
}

// দুই বিন্দুর দূরত্ব (কিমি)। কোনো একটা না থাকলে null।
export function distanceKm(aLat, aLng, bLat, bLng) {
  const n = [aLat, aLng, bLat, bLng].map(Number);
  if (n.some((x) => !isFinite(x)) || aLat === null || bLat === null) return null;
  const R = 6371;
  const dLat = ((n[2] - n[0]) * Math.PI) / 180;
  const dLng = ((n[3] - n[1]) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((n[0] * Math.PI) / 180) * Math.cos((n[2] * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ইংরেজি/বাংলিশ/বাংলা — যেকোনোভাবে লিখলে মিলবে (একই গ্রুপের সব শব্দে খোঁজে)
const SYN = [
  ['pizza', 'piza', 'pizza', 'পিৎজা', 'পিজ্জা', 'পিজা'],
  ['kacchi', 'kacci', 'kachchi', 'kachi', 'kaachi', 'কাচ্চি'],
  ['biryani', 'biriyani', 'biriani', 'biryany', 'বিরিয়ানি', 'বিরিয়ানী', 'বিরানি'],
  ['tehari', 'tehri', 'তেহারি', 'তেহারী'],
  ['burger', 'barger', 'বার্গার'],
  ['chicken', 'chiken', 'murgi', 'murgir', 'চিকেন', 'মুরগি', 'মুরগী'],
  ['beef', 'gorur', 'goru', 'বিফ', 'গরু', 'গরুর'],
  ['mutton', 'khasi', 'মাটন', 'খাসি'],
  ['fry', 'fried', 'ফ্রাই', 'ফ্রায়েড'],
  ['fries', 'french', 'ফ্রেঞ্চ'],
  ['sandwich', 'sandwitch', 'স্যান্ডউইচ'],
  ['shawarma', 'shorma', 'sharma', 'শর্মা', 'শাওয়ারমা'],
  ['noodles', 'noodle', 'nudols', 'নুডলস'],
  ['chowmein', 'chowmin', 'chaumin', 'চাউমিন'],
  ['pasta', 'পাস্তা'],
  ['soup', 'sup', 'স্যুপ', 'সুপ'],
  ['coffee', 'kofi', 'cofee', 'কফি'],
  ['tea', 'cha', 'chaa', 'চা'],
  ['cake', 'kek', 'কেক'],
  ['juice', 'jus', 'জুস'],
  ['lassi', 'লাচ্ছি', 'লাস্সি'],
  ['borhani', 'বোরহানি'],
  ['kabab', 'kebab', 'kabob', 'কাবাব'],
  ['rice', 'bhat', 'vat', 'ভাত', 'রাইস'],
  ['polao', 'pulao', 'পোলাও'],
  ['icecream', 'ice cream', 'আইসক্রিম'],
  ['set menu', 'set', 'সেট'],
];
export function searchNeedles(raw) {
  const t = String(raw || '').trim().toLowerCase();
  if (!t) return [];
  const out = [t];
  SYN.forEach((g) => {
    if (g.some((w) => w === t || (t.length >= 3 && (w.startsWith(t) || t.startsWith(w) && w.length >= 3)))) {
      g.forEach((w) => { if (out.indexOf(w) === -1) out.push(w); });
    }
  });
  return out;
}

// কুইক ডেলিভারি সুইচ: site_settings.marketplace_enabled ('true' | 'false')।
// বন্ধ থাকলে শুধু স্টাফ (delivery_shops.view) ঢুকতে পারে, টেস্টের জন্য।
// ফেরত: { enabled, staff, allowed }
export async function marketAccess() {
  let enabled = false;
  let staff = false;
  try {
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'marketplace_enabled').maybeSingle();
    enabled = !!(data && String(data.value).toLowerCase() === 'true');
  } catch (_) { enabled = false; }
  if (!enabled) {
    try {
      const { data } = await supabase.rpc('has_permission', { p_key: 'delivery_shops.view' });
      staff = data === true;
    } catch (_) { staff = false; }
  }
  return { enabled, staff, allowed: enabled || staff };
}

function minutesOf(t) {
  // 'HH:MM' বা 'HH:MM:SS' → দিনের মিনিট
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
}

// ফেরত: { open: boolean, label: string }
export function shopOpenState(shop, now = new Date()) {
  if (!shop.is_open) return { open: false, label: 'বন্ধ' };
  if (shop.busy_until && new Date(shop.busy_until).getTime() > now.getTime()) {
    return { open: false, label: 'ব্যস্ত' };
  }
  const dh = new Date(now.getTime() + DHAKA_MS); // getUTC* এখানে ঢাকার ঘড়ি দেয়
  if (shop.weekly_off !== null && shop.weekly_off !== undefined && shop.weekly_off === dh.getUTCDay()) {
    return { open: false, label: 'আজ ছুটি' };
  }
  const o = minutesOf(shop.opens_at);
  const c = minutesOf(shop.closes_at);
  if (o !== null && c !== null && o !== c) {
    const cur = dh.getUTCHours() * 60 + dh.getUTCMinutes();
    const inside = o < c ? cur >= o && cur < c : cur >= o || cur < c; // রাত পেরোনো সময়ও ধরা
    if (!inside) return { open: false, label: 'বন্ধ' };
  }
  return { open: true, label: 'খোলা' };
}

export function bnNum(n) {
  return String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
}

// ---------- শপ পেজ (ধাপ ৩) ----------
const SHOP_COLS = 'id, name, image_url, upazila, union_name, address, lat, lng, is_popular, is_open, busy_until, market_category_ids, prep_minutes, opens_at, closes_at, weekly_off, sort_order, is_test, is_active';

// একটা দোকান। RLS: সাধারণ ইউজার শুধু is_active, স্টাফ টেস্ট শপও পায়। না পেলে null।
export async function fetchMarketShop(id) {
  const { data, error } = await supabase.from('delivery_shops').select(SHOP_COLS).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data || (!data.is_active && !data.is_test)) return null;
  return data;
}

// মেনু: { cats: [{id,name}], items: [...] } — সাজানো sort_order অনুযায়ী
export async function fetchShopMenu(shopId) {
  const [c, i] = await Promise.all([
    supabase.from('delivery_shop_categories').select('id, name, sort_order').eq('shop_id', shopId).order('sort_order', { ascending: true }),
    supabase.from('delivery_shop_items').select('id, name, price, old_price, image_url, is_available, description, category_id, tags, sort_order').eq('shop_id', shopId).order('sort_order', { ascending: true }).order('name', { ascending: true }),
  ]);
  if (c.error) throw c.error;
  if (i.error) throw i.error;
  return { cats: c.data || [], items: i.data || [] };
}

// আনুমানিক ডেলিভারি সময় ('২৫–৩৫ মিনিট')
export function etaLabel(shop, km) {
  const prep = Number(shop.prep_minutes) || 15;
  const lo = Math.round((prep + 8 + (km !== null && km !== undefined ? km * 4 : 10)) / 5) * 5;
  return bnNum(lo) + '–' + bnNum(lo + 10) + ' মিনিট';
}

// 'HH:MM' → '১০:৩০ সকাল' ধরনের
export function bnTime(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  if (!m) return '';
  let h = parseInt(m[1], 10);
  const part = h < 5 ? 'রাত' : h < 12 ? 'সকাল' : h < 15 ? 'দুপুর' : h < 18 ? 'বিকেল' : h < 20 ? 'সন্ধ্যা' : 'রাত';
  h = h % 12 || 12;
  return part + ' ' + bnNum(h) + ':' + bnNum(m[2]);
}
