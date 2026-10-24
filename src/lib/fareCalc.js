// path: src/lib/fareCalc.js
// ============================================================
// ডেলিভারি অটো চার্জ — ক্লায়েন্ট হেল্পার
// হিসাব হয় সার্ভারের RPC calc_delivery_fare-এ (জিরো পয়েন্ট + কিমি রেট, সেটিং: delivery_fare_settings)।
// এখানে শুধু কল করা ও উত্তর গুছিয়ে দেওয়া — কোনো দাম ক্লায়েন্টে হিসাব হয় না।
// ব্যর্থ হলে null ফেরত (UI আগের মতোই হাতে দাম লিখতে দেয়)।
// ============================================================

import { supabase } from './supabase.js';

function toNum(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// pickup/drop: { lat, lng } অথবা null। dropUnion: বাংলা ইউনিয়নের নাম (ওভাররাইডের জন্য)।
// রিটার্ন: { enabled, fare, km, basis, source, enforceFloor } অথবা null
export async function fetchDeliveryFare({ pickup, drop, dropUnion }) {
  try {
    const { data, error } = await supabase.rpc('calc_delivery_fare', {
      p_pickup_lat: pickup ? toNum(pickup.lat) : null,
      p_pickup_lng: pickup ? toNum(pickup.lng) : null,
      p_drop_lat: drop ? toNum(drop.lat) : null,
      p_drop_lng: drop ? toNum(drop.lng) : null,
      p_drop_union: dropUnion || null,
      p_category: 'delivery',
    });
    if (error || !data) return null;
    return {
      enabled: data.enabled === true,
      fare: toNum(data.fare),
      km: toNum(data.km),
      basis: data.basis || '',
      source: data.source || '',
      enforceFloor: data.enforce_floor === true,
    };
  } catch (_) {
    return null;
  }
}
