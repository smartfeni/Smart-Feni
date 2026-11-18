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

// ---------- ধাপ ৩-ক: একটা দোকান ও তার মেনু ----------
export async function fetchShop(id) {
  const { data, error } = await supabase
    .from('delivery_shops')
    .select('id, name, image_url, upazila, union_name, address, lat, lng, is_open, busy_until, market_category_ids, prep_minutes, opens_at, closes_at, weekly_off, is_test, is_active')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !(data.is_active || data.is_test)) return null;
  return data;
}

// ফেরত: { cats: [{id,name}], items: [{id,name,price,old_price,image_url,description,category_id,tags}] }
export async function fetchShopMenu(shopId) {
  const [c, i] = await Promise.all([
    supabase.from('delivery_shop_categories').select('id, name, sort_order').eq('shop_id', shopId).order('sort_order', { ascending: true }),
    supabase.from('delivery_shop_items').select('id, name, price, old_price, image_url, description, category_id, tags, sort_order, is_available, market_category_id').eq('shop_id', shopId).eq('is_available', true).order('sort_order', { ascending: true }).order('name', { ascending: true }),
  ]);
  if (c.error) throw c.error;
  if (i.error) throw i.error;
  return { cats: c.data || [], items: i.data || [] };
}

// ---------- ১–৩ দিনের শপ (shops টেবিল) — মার্কেটের একই ক্যাটাগরিতে, একই কার্ড/শপ পেজ/চেকআউটে ----------
// যেগুলোতে market_category_ids আছে (সর্বোচ্চ ৩), চালু ও প্রকাশিত। যে শপ delivery_shops-এও আছে (ইনস্ট্যান্ট/রাইডার ফ্লো)
// সেগুলো এখানে বাদ; সেগুলো fetchMarketShops থেকে আসে। ফেরত রো: _days=true (অর্ডার = orders + বিকাশ/COD, রাইডার ছাড়া)।
export async function fetchOnlineShopsForMarket() {
  const [r, ds] = await Promise.all([
    supabase
      .from('shops')
      .select('id, name, slug, logo_image, upazila, union_name, lat, lng, market_category_id, market_category_ids, temporarily_closed, is_active, is_published, is_test, prep_minutes, opens_at, closes_at, weekly_off, busy_until, is_popular')
      .eq('is_active', true)
      .eq('is_published', true)
      .order('shop_order', { ascending: true })
      .order('name', { ascending: true }),
    supabase.from('delivery_shops').select('id'),
  ]);
  if (r.error) throw r.error;
  const instantIds = new Set(((ds && ds.data) || []).map((x) => x.id));
  return (r.data || [])
    .filter((s) => !instantIds.has(s.id) && !s.temporarily_closed)
    .map((s) => {
      const ids = Array.isArray(s.market_category_ids) && s.market_category_ids.length ? s.market_category_ids : (s.market_category_id ? [s.market_category_id] : []);
      return { ...s, image_url: s.logo_image || null, market_category_ids: ids, is_open: true, _days: true };
    })
    .filter((s) => s.market_category_ids.length > 0);
}

// কোনো শপ ইনস্ট্যান্ট (রাইডার ফ্লো) কিনা — delivery_shops-এ থাকলে হ্যাঁ।
export async function isInstantShop(id) {
  const { data } = await supabase.from('delivery_shops').select('id').eq('id', id).maybeSingle();
  return !!data;
}

// ১–৩ দিনের শপ: shops টেবিল থেকে একটা শপ (প্রকাশিত, অথবা স্টাফ/মালিকের জন্য RLS যা দেয়)।
export async function fetchDaysShop(id) {
  const { data, error } = await supabase
    .from('shops')
    .select('id, name, slug, logo_image, upazila, union_name, address, lat, lng, temporarily_closed, is_active, is_published, is_test, prep_minutes, opens_at, closes_at, weekly_off, busy_until, delivery_fee_override, market_category_ids')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.is_active || data.temporarily_closed) return null;
  return { ...data, image_url: data.logo_image || null, is_open: true, _days: true };
}

function priceOf(p) {
  const s = String(p == null ? '' : p).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)).replace(/,/g, '');
  const m = /[0-9]+(\.[0-9]+)?/.exec(s);
  return m ? parseFloat(m[0]) : 0;
}

// ১–৩ দিনের শপের পণ্য (listings) — ইনস্ট্যান্ট মেনুর মতো আকারে।
export async function fetchDaysShopMenu(shopId) {
  const { data, error } = await supabase
    .from('listings')
    .select('id, title, description, price, images, is_sold_out, shop_category_id, market_category_id')
    .eq('shop_id', shopId)
    .eq('status', 'active')
    .eq('is_disabled', false)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  const items = (data || [])
    .filter((l) => !l.is_sold_out && priceOf(l.price) > 0)
    .map((l) => ({
      id: l.id,
      name: l.title,
      price: priceOf(l.price),
      old_price: null,
      image_url: Array.isArray(l.images) && l.images.length ? l.images[0] : null,
      description: l.description ? String(l.description).slice(0, 140) : '',
      category_id: null,
      market_category_id: l.market_category_id || null,
      tags: [],
    }));
  return { cats: [], items };
}

// ---------- মার্কেট চালু-সুইচ (site_settings.marketplace_enabled) ----------
// 'true' হলে সবার জন্য খোলা; নইলে শুধু অ্যাডমিন/মডারেটর (টেস্টের জন্য) ঢুকতে পারে।
export async function marketEnabledForMe() {
  try {
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'marketplace_enabled').maybeSingle();
    const v = data && data.value;
    if (v === true || String(v).replace(/"/g, '') === 'true') return true;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return false;
    const { data: p } = await supabase.from('profiles').select('role').eq('id', session.user.id).maybeSingle();
    return !!p && (p.role === 'admin' || p.role === 'moderator');
  } catch (e) {
    return false;
  }
}
