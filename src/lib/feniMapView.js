// ============================================================
// ফেনী ম্যাপ ভিউ — সব ম্যাপ ফেনী জেলার ভেতরে আটকে রাখার কমন হেল্পার
// (SF, ২৭ নভে ২০২৬): ইউজার ফেনীর বাইরে/প্রবাসে থাকলে তার লোকেশনে যাবে না,
// ফেনীর পুরো ম্যাপ দেখাবে; ফেনীর বাইরে কোথাও পিন বসবে না।
// ============================================================
import { getFeniBounds, findAreaAt, loadFeniGeo } from '../data/feniAreas.js';
import { freePanToFeni } from './feniOverlay.js';

// সীমার চারপাশে একটু ফাঁকা (পুরনো কলারদের জন্য রাখা)
export const FENI_LOCK_PAD = 0.06;

// ফেনীতে আটকানো — এখন "ফ্রি প্যান" (SF, ২৭ নভে): ফেনীর যেকোনো কোণ (সোনাগাজীর চরসহ)
// টেনে ম্যাপের মাঝে আনা যায়; ফেনী থেকে অনেক দূরে গেলে নরমভাবে ফিরে আসে।
export function lockToFeni(map, geo) {
  if (!map || !geo || !window.L) return;
  freePanToFeni(window.L, map, getFeniBounds(geo, 0));
}

// geo নিজে লোড করে লক (যেসব পেজে geo আগে লোড হয় না)
export async function lockMapToFeni(map) {
  try {
    const geo = await loadFeniGeo();
    lockToFeni(map, geo);
    return geo;
  } catch (_) {
    return null;
  }
}

// ফেনীর পুরো ম্যাপ (উপজেলা বাছাইয়ের ম্যাপের মতো ফুল ভিউ)
export function fitFullFeni(map, geo, opts = {}) {
  if (!map || !geo) return;
  map.fitBounds(getFeniBounds(geo, 0.02), Object.assign({ animate: true }, opts));
}

// geo না থাকলে যাচাই করা যায় না, তখন true
export function insideFeni(lat, lng, geo) {
  return !geo || !!findAreaAt(lat, lng, geo);
}
