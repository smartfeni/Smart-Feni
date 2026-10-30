// path: src/lib/deliveryOrderForm.js
// ============================================================
// ডেলিভারি অর্ডার v2 (কাস্টমার ৩-ধাপ) — শেয়ার্ড লজিক, DOM ছাড়া।
// ব্যবহার করে: src/components/delivery/DeliveryOrderFlow.astro
//
// কী আছে:
//   • দোকান ও মেনু লোড (delivery_shops + delivery_shop_items, শুধু active/available)
//   • কার্ট হিসাব: আইটেমের দাম / ডেলিভারি চার্জ / মোট (মোট শুধু দেখানোর জন্য, DB-তে যায় না)
//   • API-তে পাঠানোর ডেটা: order_items = [{item_id, qty}] (নাম/দাম সার্ভার ডিবি থেকে নেয়)
//   • ঠিকানার টেক্সট বানানো (ম্যাপ লিংকের navUrl টেক্সটে জমা, UI-তে দেখানো হয় না)
// ============================================================

import { supabase } from './supabase.js';
import { UNION_BN } from '../data/feniAreas.js';

// ---------- বাংলা সংখ্যা ----------
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

export function bn(value) {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

export function taka(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '৳০';
  return '৳' + bn(Math.round(n));
}

// ---------- টাইল রঙ (স্পেকের পাঁচ রঙ) ----------
export const TILE_COLORS = ['#FFE4D6', '#FFF1C9', '#DDF0E4', '#DCE8FB', '#F3E3F7'];

export function tileColor(seed) {
  const s = String(seed || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return TILE_COLORS[h % TILE_COLORS.length];
}

// ---------- ইউনিয়নের বাংলা নাম → geojson-এর ইংরেজি নাম ----------
export const UNION_EN_BY_BN = (() => {
  const out = {};
  Object.keys(UNION_BN).forEach((en) => {
    out[UNION_BN[en]] = en;
  });
  return out;
})();

// ---------- দোকান ও মেনু লোড ----------
// রিটার্ন: { shops: [{ ...shop, items: [...] }], error }
// শুধু যেসব দোকানে অন্তত ১টা পাওয়া-যাওয়া আইটেম আছে সেগুলো ফেরত আসে
export async function fetchDeliveryShops() {
  const { data: shopsRaw, error } = await supabase
    .from('delivery_shops')
    .select('id, name, image_url, upazila, union_name, address, lat, lng, is_popular, is_active, sort_order, is_open, busy_until')
    .eq('is_active', true)
    .or('is_open.is.null,is_open.eq.true')
    .order('is_popular', { ascending: false })
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) return { shops: [], error: error.message || 'দোকান লোড করা যায়নি' };
  // মালিক "ব্যস্ত" মোডে দিলে সেই সময় পর্যন্ত দোকান তালিকায় আসে না (সার্ভারেও আটকানো আছে)
  const nowMs = Date.now();
  const shops = (shopsRaw || []).filter((s) => !s.busy_until || new Date(s.busy_until).getTime() <= nowMs);
  if (shops.length === 0) return { shops: [], error: null };

  const ids = shops.map((s) => s.id);
  const { data: items, error: itemsError } = await supabase
    .from('delivery_shop_items')
    .select('id, shop_id, name, price, image_url, is_available, sort_order')
    .in('shop_id', ids)
    .eq('is_available', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });

  if (itemsError) return { shops: [], error: itemsError.message || 'মেনু লোড করা যায়নি' };

  const byShop = {};
  (items || []).forEach((it) => {
    (byShop[it.shop_id] = byShop[it.shop_id] || []).push(it);
  });

  const result = shops
    .map((s) => ({ ...s, items: byShop[s.id] || [] }))
    .filter((s) => s.items.length > 0);

  return { shops: result, error: null };
}

// সার্চ: দোকানের নাম বা আইটেমের নাম মিললে দোকান থাকবে (দোকানের নাম মিললে সব আইটেম)
export function filterShops(shops, query) {
  const q = String(query || '').trim().normalize('NFC').toLowerCase();
  if (!q) return shops;
  const out = [];
  shops.forEach((s) => {
    const shopHit = String(s.name || '').normalize('NFC').toLowerCase().includes(q);
    if (shopHit) {
      out.push(s);
      return;
    }
    const items = s.items.filter((it) => String(it.name || '').normalize('NFC').toLowerCase().includes(q));
    if (items.length) out.push({ ...s, items });
  });
  return out;
}

// ---------- কার্ট ----------
// cart: Map<itemId, { item, shop, qty }>

export function cartCount(cart) {
  let n = 0;
  cart.forEach((c) => {
    n += c.qty;
  });
  return n;
}

export function cartItemsTotal(cart) {
  let sum = 0;
  cart.forEach((c) => {
    sum += Number(c.item.price || 0) * c.qty;
  });
  return sum;
}

// দোকান অনুযায়ী গ্রুপ (ক্রম: প্রথম যে দোকানের আইটেম যোগ হয়েছে)
export function groupCartByShop(cart) {
  const groups = new Map();
  cart.forEach((c) => {
    const g = groups.get(c.shop.id) || { shop: c.shop, lines: [] };
    g.lines.push(c);
    groups.set(c.shop.id, g);
  });
  return Array.from(groups.values());
}

// আইটেমের দাম / ডেলিভারি চার্জ / মোট — মোট শুধু দেখানোর জন্য, আলাদা কলামে রাখা হয় না
export function computeTotals(cart, charge) {
  const itemsTotal = cartItemsTotal(cart);
  const c = Number(charge);
  const deliveryCharge = Number.isFinite(c) && c > 0 ? c : 0;
  return { itemsTotal, deliveryCharge, total: itemsTotal + deliveryCharge };
}

// API-তে যাবে শুধু আইডি ও পরিমাণ (নাম/দাম/দোকান সার্ভার ডিবি থেকে বসায়)
export function buildOrderItems(cart) {
  const out = [];
  cart.forEach((c) => {
    out.push({ item_id: c.item.id, qty: c.qty });
  });
  return out;
}

// description: পুরনো রাইডার UI (যেটা শুধু description দেখায়) যেন আইটেম মিস না করে,
// তাই আইটেমের সারাংশ সবসময় সামনে থাকে, হাতে লেখা অতিরিক্ত জিনিস তার পরে
export function buildDescription(cart, manualText) {
  const parts = [];
  const lines = [];
  cart.forEach((c) => {
    lines.push(`${c.item.name} × ${bn(c.qty)}`);
  });
  if (lines.length) parts.push('আইটেম: ' + lines.join(', '));
  const manual = String(manualText || '').trim();
  if (manual) parts.push((lines.length ? 'অতিরিক্ত: ' : '') + manual);
  return parts.join('\n');
}

// ---------- ঠিকানা ----------
// loc = { text, nav, lat, lng, source, upazila, union }
// নিয়ম: লিংক UI-তে দেখানো হয় না; navUrl ঠিকানার টেক্সটের শেষে জমা থাকে
// (রাইডার/অ্যাডমিন সাইডে renderAddressWithNav লিংক সরিয়ে "নেভিগেট করুন" বাটন দেখায়)
export function composeAddress(loc) {
  const area = [loc.union, loc.upazila].filter(Boolean).join(', ');
  let out = String(loc.text || '').trim();
  if (!out && loc.source === 'current') out = 'বর্তমান লোকেশন';
  if (!out && !loc.nav && area) out = area;
  if (!out && loc.nav) out = 'ম্যাপ লোকেশন';
  if (loc.nav) out = (out + ' ' + loc.nav).trim();
  return out;
}

// ঠিকানা দেওয়া হয়েছে কিনা (টেক্সট / পিন / লিংক — যেকোনো একটা)
export function hasLocation(loc) {
  return !!(String(loc.text || '').trim() || loc.nav || (loc.lat !== null && loc.lng !== null));
}
