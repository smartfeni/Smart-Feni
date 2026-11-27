// ============================================================
// ফেনী ম্যাপ ভিউ — সব ম্যাপ ফেনী জেলার ভেতরে আটকে রাখার কমন হেল্পার
// (SF, ২৭ নভে ২০২৬): ইউজার ফেনীর বাইরে/প্রবাসে থাকলে তার লোকেশনে যাবে না,
// ফেনীর পুরো ম্যাপ দেখাবে; ফেনীর বাইরে কোথাও পিন বসবে না।
// ============================================================
import { getFeniBounds, findAreaAt, loadFeniGeo } from '../data/feniAreas.js';

// সীমার চারপাশে একটু ফাঁকা, যাতে কিনারের জায়গায় পিন বসাতে টানাটানি না হয়
export const FENI_LOCK_PAD = 0.06;

// ম্যাপ ফেনীর সীমার বাইরে প্যান/জুম-আউট করা যাবে না
export function lockToFeni(map, geo) {
  if (!map || !geo) return;
  map.setMaxBounds(getFeniBounds(geo, FENI_LOCK_PAD));
  map.options.maxBoundsViscosity = 1.0;
  if (!(map.options.minZoom >= 9)) map.setMinZoom(9);
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
