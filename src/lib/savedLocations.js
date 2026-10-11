// path: src/lib/savedLocations.js
// ============================================================
// ব্যক্তিগত সেভড লোকেশন (বাসা, অফিস ইত্যাদি) — Delivery/Ride Hero
// অর্ডার ফর্মে ঠিকানা বক্সে ট্যাপ করলে সাজেশন হিসেবে দেখানোর জন্য।
//
// টেবিল: public.saved_locations (Supabase) — RLS নিজেই নিশ্চিত করে
// প্রতিটা ইউজার শুধু নিজের রো দেখতে/বদলাতে/মুছতে পারবে, তাই এখানে
// সরাসরি `supabase` (client-side, RLS-scoped) ব্যবহার হচ্ছে, কোনো
// API endpoint লাগে না। (chatClient.js-এর মতোই প্যাটার্ন)
//
// ডেটাবেজ নিয়ম (এখানে আবার চেক করা হয়, কিন্তু আসল গার্ড DB-তে):
//   - প্রতি ইউজারে সর্বোচ্চ ১০টা (trigger)
//   - একই নাম (trim + ছোট হাতের) দুবার নয় (unique index)
//   - নাম ১–৩০ অক্ষর, ঠিকানা ১–৩০০ অক্ষর, lat/lng বৈধ সীমায়
//
// সব ফাংশন { data, error } ফেরত দেয় — error হলো বাংলা স্ট্রিং বা null
// (chatClient.js-এর কনভেনশন)।
//
// ক্যাশ: লিস্ট একবার আনলে মেমরিতে থাকে (পেজ রিফ্রেশে মুছে যায়)।
// লগআউট/ইউজার বদলালে অটো ক্লিয়ার। সেভ/ডিলিটে ক্যাশ নিজে আপডেট হয়।
// ============================================================

import { supabase } from './supabase.js';

export const MAX_SAVED_LOCATIONS = 10;
export const MAX_NAME_LENGTH = 30;

// "সেভ করুন" বক্সের দ্রুত বাছাইয়ের চিপ
export const QUICK_NAMES = [
  { label: 'বাসা', icon: 'fa-house' },
  { label: 'অফিস', icon: 'fa-building' },
];

// ------------------------------------------------------------
// ইন্টারনাল: ক্যাশ ও হেল্পার
// ------------------------------------------------------------
let cache = null; // null = এখনো আনা হয়নি
let cacheUserId = null;
let inflight = null;

function clearCache() {
  cache = null;
  cacheUserId = null;
  inflight = null;
}

// নাম স্বাভাবিক করা: দুই পাশের ফাঁকা বাদ, মাঝের একাধিক স্পেস এক স্পেস
export function normalizeName(name) {
  return String(name || '').replace(/\s+/g, ' ').trim();
}

function nameKey(name) {
  return normalizeName(name).toLowerCase();
}

function round6(n) {
  return Math.round(Number(n) * 1e6) / 1e6;
}

async function getUserId() {
  const { data: { session } } = await supabase.auth.getSession();
  return session ? session.user.id : null;
}

// DB এরর → ইউজার-ফ্রেন্ডলি বাংলা বার্তা
function friendlyError(error) {
  if (!error) return null;
  const code = error.code || '';
  const msg = String(error.message || '');
  if (code === 'P0001' && msg.includes('saved_locations_limit_reached')) {
    return 'সর্বোচ্চ ১০টা ঠিকানা সেভ করা যায় — আগে একটা মুছে ফেলুন';
  }
  if (code === '23505') return 'এই নামে আগেই একটা ঠিকানা সেভ করা আছে';
  if (code === '23514') return 'ঠিকানা বা লোকেশনের তথ্য সঠিক নয়';
  if (code === '42501') return 'এই কাজের অনুমতি নেই — আবার লগইন করে চেষ্টা করুন';
  return 'কিছু একটা সমস্যা হয়েছে — আবার চেষ্টা করুন';
}

function sortList(list) {
  // সর্বশেষ আপডেট করা আগে
  return list.slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
}

// লগআউট বা অন্য ইউজারে লগইন হলে ক্যাশ মুছে ফেলা
supabase.auth.onAuthStateChange((event, session) => {
  const uid = session ? session.user.id : null;
  if (event === 'SIGNED_OUT' || (cacheUserId && uid !== cacheUserId)) {
    clearCache();
  }
});

// ------------------------------------------------------------
// পাবলিক: নামের জন্য আইকন (FontAwesome ক্লাস)
// ------------------------------------------------------------
export function iconForName(name) {
  const n = nameKey(name);
  if (/বাসা|বাড়ি|বাড়ী|home|house/.test(n)) return 'fa-house';
  if (/অফিস|office|কর্মস্থল|দোকান|shop/.test(n)) return 'fa-building';
  return 'fa-location-dot';
}

// ------------------------------------------------------------
// পাবলিক: সব সেভড লোকেশন আনা
// force=true হলে ক্যাশ ফেলে নতুন করে আনে
// রিটার্ন: { data: [...], error }  (লগইন না থাকলে data: [] আর error: null)
// ------------------------------------------------------------
export async function listSavedLocations({ force = false } = {}) {
  const uid = await getUserId();
  if (!uid) {
    clearCache();
    return { data: [], error: null };
  }

  if (!force && cache && cacheUserId === uid) {
    return { data: cache.slice(), error: null };
  }
  if (!force && inflight && cacheUserId === uid) {
    return inflight;
  }

  cacheUserId = uid;
  const request = (async () => {
    const { data, error } = await supabase
      .from('saved_locations')
      .select('id, name, address, lat, lng, upazila, union_name, created_at, updated_at')
      .order('updated_at', { ascending: false });

    inflight = null;
    if (error) {
      return { data: cache ? cache.slice() : [], error: friendlyError(error) };
    }
    cache = data || [];
    return { data: cache.slice(), error: null };
  })();

  inflight = request;
  return request;
}

// ------------------------------------------------------------
// পাবলিক: নতুন লোকেশন সেভ (একই নাম থাকলে সেটা আপডেট হয়)
// input: { name, address, lat, lng, upazila?, union? }
//   upazila — বাংলা নাম (profiles.upazila-র মতো), union — ইউনিয়নের বাংলা নাম
// রিটার্ন: { data: সেভ হওয়া রো, error, updated: true/false }
// ------------------------------------------------------------
export async function saveLocation({ name, address, lat, lng, upazila = null, union = null }) {
  const cleanName = normalizeName(name);
  const cleanAddress = String(address || '').trim();

  if (!cleanName) return { data: null, error: 'ঠিকানার একটা নাম দিন (যেমন: বাসা)', updated: false };
  if (cleanName.length > MAX_NAME_LENGTH) {
    return { data: null, error: 'নাম ৩০ অক্ষরের মধ্যে রাখুন', updated: false };
  }
  if (!cleanAddress) return { data: null, error: 'ঠিকানা খালি — আগে ম্যাপে লোকেশন বেছে নিন', updated: false };
  if (cleanAddress.length > 300) {
    return { data: null, error: 'ঠিকানা অনেক লম্বা — একটু ছোট করুন', updated: false };
  }

  const la = Number(lat);
  const ln = Number(lng);
  if (!isFinite(la) || !isFinite(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
    return { data: null, error: 'লোকেশন পাওয়া যায়নি — ম্যাপে পিন বসান', updated: false };
  }

  const uid = await getUserId();
  if (!uid) return { data: null, error: 'সেভ করতে আগে লগইন করুন', updated: false };

  const fields = {
    name: cleanName,
    address: cleanAddress,
    lat: round6(la),
    lng: round6(ln),
    upazila: upazila || null,
    union_name: union || null,
  };

  // একই নাম আগে থেকে থাকলে সেটাই আপডেট করব
  const { data: existingList, error: listErr } = await listSavedLocations({ force: true });
  if (listErr && !existingList.length) {
    return { data: null, error: listErr, updated: false };
  }
  const existing = existingList.find((r) => nameKey(r.name) === nameKey(cleanName));

  if (existing) {
    return updateRow(existing.id, fields);
  }

  const { data, error } = await supabase
    .from('saved_locations')
    .insert(fields)
    .select('id, name, address, lat, lng, upazila, union_name, created_at, updated_at')
    .single();

  if (error) {
    // দুই ট্যাবে একসাথে একই নাম দিলে unique violation → আপডেটে ফলব্যাক
    if (error.code === '23505') {
      const { data: fresh } = await listSavedLocations({ force: true });
      const dup = fresh.find((r) => nameKey(r.name) === nameKey(cleanName));
      if (dup) return updateRow(dup.id, fields);
    }
    return { data: null, error: friendlyError(error), updated: false };
  }

  cache = sortList([...(cache || []), data]);
  cacheUserId = uid;
  return { data, error: null, updated: false };
}

async function updateRow(id, fields) {
  const { data, error } = await supabase
    .from('saved_locations')
    .update(fields)
    .eq('id', id)
    .select('id, name, address, lat, lng, upazila, union_name, created_at, updated_at')
    .single();

  if (error) return { data: null, error: friendlyError(error), updated: true };

  if (cache) {
    cache = sortList(cache.map((r) => (r.id === id ? data : r)));
  }
  return { data, error: null, updated: true };
}

// ------------------------------------------------------------
// পাবলিক: মুছে ফেলা
// রিটার্ন: { error }
// ------------------------------------------------------------
export async function deleteSavedLocation(id) {
  if (!id) return { error: 'কোন ঠিকানা মুছবেন বোঝা যায়নি' };

  const { error } = await supabase
    .from('saved_locations')
    .delete()
    .eq('id', id);

  if (error) return { error: friendlyError(error) };

  if (cache) cache = cache.filter((r) => r.id !== id);
  return { error: null };
}

// ------------------------------------------------------------
// পাবলিক: টাইপ করা লেখা দিয়ে লিস্ট ফিল্টার (নাম বা ঠিকানা মিললে)
// খালি query হলে পুরো লিস্টই ফেরত
// ------------------------------------------------------------
export function filterSavedLocations(list, query) {
  const q = nameKey(query);
  if (!q) return list;
  return list.filter((r) => nameKey(r.name).includes(q) || nameKey(r.address).includes(q));
}

// টেস্ট/লগআউট হ্যান্ডলিংয়ের জন্য বাইরে থেকেও ক্যাশ ফেলা যাবে
export function clearSavedLocationsCache() {
  clearCache();
}