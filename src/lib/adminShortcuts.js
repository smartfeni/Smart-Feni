// ============================================================
// অ্যাডমিন শর্টকাটের সংরক্ষণ (প্রিয়, সাম্প্রতিক, ব্যাজ-কাউন্ট)
// ============================================================
// ড্যাশবোর্ড (/admin) ও দ্রুত মেনু (adminQuickNav.js) দুজনেই এটা ব্যবহার করে।
// সব কিছু এই ডিভাইসের localStorage-এ থাকে (SF-এর সিদ্ধান্ত: আপাতত ডিভাইসে)।
// মান শুধু পেজ-পাথ ('/admin/doctors') — কখনো innerHTML-এ বসানো হয় না,
// শুধু জানা পেজের সাথে মিলিয়ে দেখা হয়।
// ============================================================

const K_FAV = 'sf_admin_favs';
const K_REC = 'sf_admin_recent';
const K_BADGE = 'sf_admin_badges';
const MAX_RECENT = 8;
const BADGE_TTL_MS = 60 * 60 * 1000; // ১ ঘণ্টার পুরনো কাউন্ট দেখানো হয় না

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : v;
  } catch (_) {
    return fallback;
  }
}

function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* প্রাইভেট মোড/ভরা স্টোরেজ — চুপচাপ বাদ */ }
}

function pathList(key) {
  const v = read(key, []);
  return Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.indexOf('/admin/') === 0) : [];
}

export function bn(n) {
  return String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
}

export function getFavs() {
  return pathList(K_FAV);
}

// প্রিয়তে থাকলে সরায়, না থাকলে যোগ করে। নতুন অবস্থা (true = প্রিয়) ফেরত দেয়।
export function toggleFav(path) {
  const cur = getFavs();
  const has = cur.indexOf(path) !== -1;
  write(K_FAV, has ? cur.filter((p) => p !== path) : cur.concat([path]));
  return !has;
}

export function getRecent() {
  return pathList(K_REC);
}

export function pushRecent(path) {
  const cur = getRecent().filter((p) => p !== path);
  cur.unshift(path);
  write(K_REC, cur.slice(0, MAX_RECENT));
}

// ড্যাশবোর্ড পেন্ডিং কাউন্ট জমা রাখে ({ '/admin/doctors': 2 }), যাতে অন্য পেজের মেনুতেও ব্যাজ দেখায়
export function saveBadges(map) {
  write(K_BADGE, { t: Date.now(), v: map || {} });
}

export function getBadges() {
  const o = read(K_BADGE, null);
  if (!o || typeof o !== 'object' || !o.t || Date.now() - o.t > BADGE_TTL_MS) return {};
  return o.v && typeof o.v === 'object' ? o.v : {};
}
