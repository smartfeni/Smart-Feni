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
    supabase.from('delivery_shop_items').select('id, name, price, old_price, image_url, description, category_id, tags, sort_order, is_available').eq('shop_id', shopId).eq('is_available', true).order('sort_order', { ascending: true }).order('name', { ascending: true }),
  ]);
  if (c.error) throw c.error;
  if (i.error) throw i.error;
  return { cats: c.data || [], items: i.data || [] };
}

// ---------- অনলাইন শপ (shops টেবিল) — মার্কেটের একই ক্যাটাগরিতে দেখানো ----------
// শুধু যেগুলোতে অ্যাডমিন market_category_id বসিয়েছে, চালু ও সাময়িক-বন্ধ নয়।
// ফেরত রো delivery-দোকানের মতো আকারে (market_category_ids, image_url) + _online=true।
export async function fetchOnlineShopsForMarket() {
  const { data, error } = await supabase
    .from('shops')
    .select('id, name, slug, logo_image, upazila, market_category_id, temporarily_closed, is_active, is_published')
    .eq('is_active', true)
    .eq('is_published', true)
    .not('market_category_id', 'is', null)
    .order('shop_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw error;
  return (data || [])
    .filter((s) => !s.temporarily_closed)
    .map((s) => ({
      id: 'online:' + s.id,
      name: s.name,
      image_url: s.logo_image || null,
      upazila: s.upazila || '',
      market_category_ids: [s.market_category_id],
      _online: true,
      _href: '/' + s.slug,
      is_open: true,
    }));
}
