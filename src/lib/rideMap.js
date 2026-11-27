// ============================================================
// লোকাল রাইড (নতুন /ride) — ম্যাপ ও গাড়ির হেল্পার
// - দূরত্ব: সোজা দূরত্ব × রাস্তার গুণক (১.৩), সময়: গড় ২০ কিমি/ঘণ্টা + ৩ মিনিট — শুধু আনুমানিক
// - পিন/মার্কার: Leaflet divIcon (inline style; Astro scoped CSS এখানে লাগে না)
// - গাড়ির আইকন ও কতজন বসতে পারে: local_ride_vehicle_types.name_bn দেখে (DB-তে সিট নেই, তাই আনুমানিক)
// - ইউনিয়ন: feniAreas.js-এর বাংলা নাম ↔ geojson shapeName
// সব লেখা বাংলা সংখ্যায় (bn)।
// ============================================================
import { UNION_BN, UPAZILAS, getUnionUpazilaId } from '../data/feniAreas.js';

export const FENI_CENTER = [23.0159, 91.3976];
const BN = '০১২৩৪৫৬৭৮৯';
export const bn = (n) => String(n).replace(/\d/g, (d) => BN[d]);

// ---------- দূরত্ব ও সময় ----------
export function straightKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const toR = (x) => (x * Math.PI) / 180;
  const dLat = toR(bLat - aLat);
  const dLng = toR(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
export function estimateTrip(aLat, aLng, bLat, bLng) {
  const km = straightKm(aLat, aLng, bLat, bLng) * 1.3;
  const min = Math.max(5, Math.round((km / 20) * 60 + 3));
  return { km, min };
}
export function kmLabel(km) {
  if (km < 1) return '~১ কিমির কম';
  return '~' + bn(km < 10 ? Math.round(km * 10) / 10 : Math.round(km)) + ' কিমি';
}

// ---------- ইউনিয়ন নাম ----------
const EN_BY_BN = {};
Object.keys(UNION_BN).forEach((en) => { EN_BY_BN[UNION_BN[en]] = en; });
export function unionEnOf(bnName) { return EN_BY_BN[bnName] || null; }
export function upazilaBnOfUnionEn(en) {
  const id = getUnionUpazilaId(en);
  const u = UPAZILAS.find((x) => x.id === id);
  return u ? u.name : '';
}

// ---------- মার্কার ----------
export function pickupIcon(L) {
  return L.divIcon({
    className: '',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    html: '<div style="width:26px;height:26px;border-radius:50%;background:#1B2A4A;border:4px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);box-sizing:border-box"></div>',
  });
}
export function dropIcon(L) {
  return L.divIcon({
    className: '',
    iconSize: [34, 44],
    iconAnchor: [17, 42],
    html: '<svg width="34" height="44" viewBox="0 0 44 56" aria-hidden="true"><path d="M22 54c0 0 18-19.5 18-32A18 18 0 0 0 4 22c0 12.5 18 32 18 32z" fill="#FF6B35" stroke="#fff" stroke-width="3"/><circle cx="22" cy="22" r="7" fill="#fff"/></svg>',
  });
}

// ---------- গাড়ি ----------
const V = {
  three: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M5 18V9a6 6 0 0 1 6-6h10l6 7v8H5z" fill="currentColor" fill-opacity=".14"/><path d="M13 3v7h14"/><circle cx="10" cy="20" r="3" fill="#fff"/><circle cx="25" cy="20" r="3" fill="#fff"/></svg>',
  auto: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M6 18V8h16l6 6v4H6z" fill="currentColor" fill-opacity=".14"/><path d="M6 8l3-5h10"/><circle cx="11" cy="20" r="3" fill="#fff"/><circle cx="24" cy="20" r="3" fill="#fff"/></svg>',
  bike: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="19" r="4" fill="#fff"/><circle cx="26" cy="19" r="4" fill="#fff"/><path d="M8 19l6-9h7l5 9M14 10l-2-4h-3M21 10l2-4h3"/></svg>',
  car: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 17v-4l4-6h18l5 6v4H3z" fill="currentColor" fill-opacity=".14"/><path d="M8 7l-2 6h22l-3-6"/><circle cx="9" cy="19" r="3" fill="#fff"/><circle cx="25" cy="19" r="3" fill="#fff"/></svg>',
  van: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 18V5h20l7 6v7H3z" fill="currentColor" fill-opacity=".14"/><path d="M23 5v6h7M9 5v6M16 5v6"/><circle cx="9" cy="20" r="3" fill="#fff"/><circle cx="25" cy="20" r="3" fill="#fff"/></svg>',
  pickup: '<svg viewBox="0 0 34 26" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 18v-6h13V7h8l6 6v5H3z" fill="currentColor" fill-opacity=".14"/><path d="M24 7v6h6"/><circle cx="9" cy="20" r="3" fill="#fff"/><circle cx="25" cy="20" r="3" fill="#fff"/></svg>',
};
// নাম দেখে আইকন + আনুমানিক যাত্রী (সিট)
export function vehicleMeta(nameBn) {
  const n = String(nameBn || '');
  if (/সিএনজি/.test(n)) return { icon: V.three, seats: 3 };
  if (/ইজি/.test(n)) return { icon: V.auto, seats: 5 };
  if (/অটো/.test(n)) return { icon: V.auto, seats: 4 };
  if (/মোটর|বাইক/.test(n)) return { icon: V.bike, seats: 1 };
  if (/মাইক্রো/.test(n)) return { icon: V.van, seats: 10 };
  if (/পিকআপ|ট্রাক/.test(n)) return { icon: V.pickup, seats: 0 };
  if (/কার/.test(n)) return { icon: V.car, seats: 4 };
  return { icon: V.three, seats: 0 };
}
