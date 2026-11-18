// path: src/lib/marketCart.js
// ============================================================
// মার্কেটপ্লেস (ব্রান্চ: marketplace) — ধাপ ৩-ক: ফোনে সংরক্ষিত কার্ট ও ড্রপ লোকেশন।
// - কার্টে এক সময়ে শুধু এক দোকান (শপ বদলালে আগের কার্ট খালি হয়)।
// - কার্টে শুধু { item_id, qty } ও দেখানোর জন্য নাম/দাম থাকে; আসল দাম/নাম/দোকান
//   অর্ডারের সময় DB ট্রিগার (delivery_normalize_items) নিজে ঠিক করে, তাই এখানের দামে বিশ্বাস নেই।
// - সব ফাংশন localStorage ব্যর্থ হলে মেমরিতে চলে (try/catch)।
// ============================================================

const CART_KEY = 'smartfeni_market_cart';
const DROP_KEY = 'smartfeni_market_drop';
const MAX_QTY = 20;
const MAX_LINES = 30;

let memCart = null;
let memDrop = null;

function read(key, mem) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return mem;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) { /* মেমরিতে থাকবে */ }
}

function emit() {
  try { window.dispatchEvent(new CustomEvent('smartfeni:market-cart-changed')); } catch (e) {}
}

// ---------- কার্ট ----------
// গঠন: { shopId, shopName, lines: [{ id, name, price, qty }] }
export function getCart() {
  const c = read(CART_KEY, memCart);
  if (!c || !Array.isArray(c.lines)) return { shopId: null, shopName: '', lines: [] };
  return c;
}

function saveCart(c) {
  memCart = c;
  write(CART_KEY, c);
  emit();
}

export function cartCount(c = getCart()) {
  return c.lines.reduce((n, l) => n + l.qty, 0);
}

export function cartTotal(c = getCart()) {
  return c.lines.reduce((n, l) => n + l.qty * (Number(l.price) || 0), 0);
}

export function qtyOf(itemId, c = getCart()) {
  const l = c.lines.find((x) => x.id === itemId);
  return l ? l.qty : 0;
}

// ফেরত: 'ok' | 'other_shop' (অন্য দোকানের কার্ট আছে, replace=true না দিলে বদলায় না) | 'max'
export function addItem(shop, item, { replace = false } = {}) {
  let c = getCart();
  if (c.shopId && c.shopId !== shop.id) {
    if (!replace && c.lines.length) return 'other_shop';
    c = { shopId: shop.id, shopName: shop.name, lines: [] };
  }
  if (!c.shopId) c = { shopId: shop.id, shopName: shop.name, lines: [] };
  const l = c.lines.find((x) => x.id === item.id);
  if (l) {
    if (l.qty >= MAX_QTY) return 'max';
    l.qty += 1;
    l.price = Number(item.price) || 0;
  } else {
    if (c.lines.length >= MAX_LINES) return 'max';
    c.lines.push({ id: item.id, name: item.name, price: Number(item.price) || 0, qty: 1 });
  }
  saveCart(c);
  return 'ok';
}

export function decItem(itemId) {
  const c = getCart();
  const l = c.lines.find((x) => x.id === itemId);
  if (!l) return;
  l.qty -= 1;
  c.lines = c.lines.filter((x) => x.qty > 0);
  if (!c.lines.length) {
    c.shopId = null;
    c.shopName = '';
  }
  saveCart(c);
}

export function clearCart() {
  saveCart({ shopId: null, shopName: '', lines: [] });
}

// ---------- ড্রপ লোকেশন ----------
// গঠন: { address, lat, lng, upazila, union, instructions, source }
export function getDrop() {
  const d = read(DROP_KEY, memDrop);
  if (!d || typeof d.address !== 'string' || !d.address.trim()) return null;
  return d;
}

export function setDrop(d) {
  const clean = {
    address: String(d.address || '').trim().slice(0, 300),
    lat: typeof d.lat === 'number' && isFinite(d.lat) ? d.lat : null,
    lng: typeof d.lng === 'number' && isFinite(d.lng) ? d.lng : null,
    upazila: d.upazila ? String(d.upazila).slice(0, 60) : '',
    union: d.union ? String(d.union).slice(0, 60) : '',
    instructions: String(d.instructions || '').trim().slice(0, 300),
    source: d.source || 'text',
  };
  memDrop = clean;
  write(DROP_KEY, clean);
  try { window.dispatchEvent(new CustomEvent('smartfeni:market-drop-changed')); } catch (e) {}
}

export function clearDrop() {
  memDrop = null;
  try { localStorage.removeItem(DROP_KEY); } catch (e) {}
  try { window.dispatchEvent(new CustomEvent('smartfeni:market-drop-changed')); } catch (e) {}
}
