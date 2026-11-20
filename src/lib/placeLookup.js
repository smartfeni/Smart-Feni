// path: src/lib/placeLookup.js
// ============================================================
// ম্যাপের জায়গার নাম ও সার্চ — শেয়ার্ড (কুইক ডেলিভারি MarketLocationSheet)
//
// lookupPlaceName(lat, lng): পিনের জায়গার ছোট নাম
//   ১) নিজেদের location_suggestions (/api/location-suggestions-nearby) — ১৫০ মিটারের ভেতর সবচেয়ে কাছের
//   ২) না পেলে Nominatim reverse (বাংলা), রাস্তা/এলাকা/গ্রামের নাম
// searchPlaces(q): নিজেদের সার্চ API + Nominatim (শুধু ফেনীর বক্সে), ডুপ্লিকেট বাদ
// cleanName(): "Police Line ফেনী পুলিশ লাইন" → "ফেনী পুলিশ লাইন"
// কোনো ফাংশন throw করে না; ব্যর্থ হলে ফাঁকা নাম/তালিকা।
// ============================================================

const BN_RE = /[ঀ-৿]/;
const NEAR_M = 150;
const FENI_VIEWBOX = '91.20,23.32,91.62,22.72';
const _nameCache = new Map();

export function cleanName(n) {
  n = String(n || '').trim();
  if (!BN_RE.test(n) || !/[A-Za-z]/.test(n)) return n;
  const t = n
    .replace(/[A-Za-z][A-Za-z.'’\-]*/g, ' ')
    .replace(/^[^ঀ-৿]+/, '')
    .replace(/[^ঀ-৿)]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return t || n;
}

export function distanceM(aLat, aLng, bLat, bLng) {
  const k = Math.PI / 180;
  const x = (bLng - aLng) * k * Math.cos(((aLat + bLat) / 2) * k);
  const y = (bLat - aLat) * k;
  return Math.sqrt(x * x + y * y) * 6371000;
}

export async function lookupPlaceName(lat, lng) {
  const key = lat.toFixed(4) + ',' + lng.toFixed(4);
  if (_nameCache.has(key)) return _nameCache.get(key);
  let name = '';
  try {
    const d = 0.0016;
    const qs =
      'south=' + (lat - d).toFixed(4) + '&west=' + (lng - d).toFixed(4) +
      '&north=' + (lat + d).toFixed(4) + '&east=' + (lng + d).toFixed(4) + '&limit=60';
    const r = await fetch('/api/location-suggestions-nearby?' + qs);
    if (r.ok) {
      const j = await r.json();
      let best = null;
      let bd = Infinity;
      (j.results || []).forEach((p) => {
        const dd = distanceM(lat, lng, Number(p.lat), Number(p.lng));
        if (dd < bd) { bd = dd; best = p; }
      });
      if (best && bd <= NEAR_M) name = best.name || '';
    }
  } catch (e) { /* Nominatim ফলব্যাক */ }
  if (!name) {
    try {
      const r = await fetch(
        'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&accept-language=bn&lat=' + lat + '&lon=' + lng
      );
      if (r.ok) {
        const j = await r.json();
        const a = j.address || {};
        name = j.name || a.amenity || a.shop || a.road || a.neighbourhood || a.suburb || a.hamlet || a.village || a.town || '';
      }
    } catch (e) { /* নাম ছাড়াই চলবে */ }
  }
  name = cleanName(name);
  _nameCache.set(key, name);
  return name;
}

async function searchOwn(q) {
  try {
    const r = await fetch('/api/location-suggestions-search?q=' + encodeURIComponent(q));
    if (!r.ok) return [];
    const j = await r.json();
    return (j.results || [])
      .filter((x) => x.lat !== null && x.lat !== undefined && x.lng !== null && x.lng !== undefined)
      .map((x) => ({ name: cleanName(x.name), sub: x.upazila || '', lat: Number(x.lat), lng: Number(x.lng) }));
  } catch (e) {
    return [];
  }
}

async function searchOsm(q) {
  try {
    const r = await fetch(
      'https://nominatim.openstreetmap.org/search?format=json&accept-language=bn&countrycodes=bd&bounded=1&viewbox=' +
        FENI_VIEWBOX + '&limit=6&q=' + encodeURIComponent(q)
    );
    if (!r.ok) return [];
    const j = await r.json();
    return (j || []).map((x) => {
      const parts = String(x.display_name || '').split(',').map((t) => t.trim()).filter(Boolean);
      return { name: cleanName(x.name || parts[0] || ''), sub: parts.slice(1, 3).join(', '), lat: Number(x.lat), lng: Number(x.lon) };
    });
  } catch (e) {
    return [];
  }
}

// keep(r) → false দিলে বাদ (যেমন ফেনীর বাইরে)
export async function searchPlaces(q, keep) {
  const [own, osm] = await Promise.all([searchOwn(q), searchOsm(q)]);
  const seen = new Set();
  return own
    .concat(osm)
    .filter((r) => {
      if (!r.name || !isFinite(r.lat) || !isFinite(r.lng)) return false;
      if (keep && !keep(r)) return false;
      const k = r.name + '|' + r.lat.toFixed(3) + '|' + r.lng.toFixed(3);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, 10);
}
