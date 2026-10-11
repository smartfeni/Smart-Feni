// path: src/data/feniAreas.js
// ============================================================
// ফেনী জেলার উপজেলা ↔ ইউনিয়ন/পৌরসভা ডেটা + লোকেশন ম্যাচিং হেল্পার
//
// ব্যবহার করবে: LocationSelector.astro (হেডার), LocationPicker.astro
// (Delivery/Ride Hero)।
//
// সোর্স: public/data/feni_unions.geojson (geoBoundaries ADM4, ৪৮টা এলাকা:
// ৪৩ ইউনিয়ন + ৫ পৌরসভা)। বাউন্ডারি সরলীকৃত — ইউনিয়নের একদম
// কিনারায় পিন ভুল ইউনিয়ন দেখাতে পারে, ডেলিভারি/রাইডের কাজে সমস্যা নেই।
//
// নাম নিয়ম: উপজেলার বাংলা নাম LocationSelector / profiles.upazila-এর
// সাথে হুবহু মেলানো (দাগনভূঞা — দাগনভূঁইয়া নয়), যাতে ডেটাবেজ
// ফরম্যাট ভেঙে না যায়।
//
// কোনো বাইরের লাইব্রেরি লাগে না (point-in-polygon নিজেই করা)।
//
// আপডেট (ম্যাপে ৪ লেভেলের আলাদা রঙের বর্ডার): বাংলাদেশের সীমানা
// (public/data/bangladesh.geojson, geoBoundaries ADM0 — অনেক সরলীকৃত, তাই
// শুধু জুম-আউট/দেশ ভিউতে ব্যবহার্য), BORDER_COLORS (দেশ/জেলা/উপজেলা/ইউনিয়ন)
// এবং দেশ-ভিউয়ের মাস্ক হেল্পার যোগ হলো। আগের কোনো export বদলায়নি।
// ============================================================

export const GEOJSON_URL = '/data/feni_unions.geojson';

// বাংলাদেশের সীমানা (ADM0, সরলীকৃত) — শুধু দেশ-ভিউ/জুম-আউটে আঁকার জন্য।
// ফেনীর কাছাকাছি এর লাইন ইউনিয়ন বর্ডার থেকে কয়েক কিমি সরে যায়, তাই
// ফেনীতে জুম করলে এটা লুকিয়ে রাখতে হবে (LocationSelector সেটাই করে)।
export const BANGLADESH_URL = '/data/bangladesh.geojson';

// ম্যাপে ৪ লেভেলের বর্ডারের আলাদা রঙ (সব জায়গায় এখান থেকেই নেওয়া হবে)
export const BORDER_COLORS = {
  country: '#1B2A4A',  // দেশ — নেভি
  district: '#FF6B35', // জেলা (ফেনী) — ব্র্যান্ড কমলা, সবচেয়ে বোল্ড
  upazila: '#6D28D9',  // উপজেলা — বেগুনি
  union: '#0D9488',    // ইউনিয়ন — টিল
};

// উপজেলা — id (slug) LocationSelector-এর সাথে মেলে, name বাংলা
export const UPAZILAS = [
  { id: 'feni-sadar', name: 'ফেনী সদর', color: '#e74c3c' },
  { id: 'chhagalnaiya', name: 'ছাগলনাইয়া', color: '#27ae60' },
  { id: 'daganbhuiyan', name: 'দাগনভূঞা', color: '#2980b9' },
  { id: 'parshuram', name: 'পরশুরাম', color: '#e67e22' },
  { id: 'fulgazi', name: 'ফুলগাজী', color: '#8e44ad' },
  { id: 'sonagazi', name: 'সোনাগাজী', color: '#16a085' },
];

// উপজেলা → ইউনিয়ন/পৌরসভা (geojson-এর shapeName অনুযায়ী ইংরেজি নাম)
const UNIONS_BY_UPAZILA = {
  'chhagalnaiya': ['Radhanagar', 'Pathannagar', 'Shubhapur', 'Gopal', 'Mohamaya', 'Chhagalnaiya Paurashava'],
  'daganbhuiyan': ['Sindurpur', 'Rajapur', 'Purba Chandrapur', 'Ramnagar', 'Yakubpur', 'Daganbhuiyan', 'Mathu Bhuiyan', 'Jailashkara', 'Daganbhuiyan Paurashava'],
  'parshuram': ['Mirzanagar', 'Chithalia', 'Baksh Mohammad', 'Parshuram Paurashava'],
  'fulgazi': ['Fulgazi', 'Munshirhat', 'Darbarpur', 'Anandapur', 'G.M.Hat', 'Amjadhat'],
  'feni-sadar': ['Sarishadi', 'Panchgachhiya', 'Dharmapur', 'Kazirbag', 'Kalidah', 'Baligaon', 'Dhalia', 'Lemua', 'Sanua', 'Matabi', 'Fazilpur', 'Farhadnagar', 'Feni Paurashava'],
  'sonagazi': ['Char Majlishpur', 'Bagadana', 'Mangalkandi', 'Matiganj', 'Char Darbesh', 'Char Chandia', 'Sonagazi', 'Amirabad', 'Nawabpur', 'Sonagazi Paurashava'],
};

// ইউনিয়ন/পৌরসভার বাংলা নাম
export const UNION_BN = {
  'Radhanagar': 'রাধানগর', 'Pathannagar': 'পাঠাননগর', 'Shubhapur': 'শুভপুর',
  'Gopal': 'ঘোপাল', 'Mohamaya': 'মহামায়া', 'Chhagalnaiya Paurashava': 'ছাগলনাইয়া পৌরসভা',
  'Sindurpur': 'সিন্দুরপুর', 'Rajapur': 'রাজাপুর', 'Purba Chandrapur': 'পূর্ব চন্দ্রপুর',
  'Ramnagar': 'রামনগর', 'Yakubpur': 'ইয়াকুবপুর', 'Daganbhuiyan': 'দাগনভূঞা সদর',
  'Mathu Bhuiyan': 'মাতুভূঞা', 'Jailashkara': 'জায়লস্কর', 'Daganbhuiyan Paurashava': 'দাগনভূঞা পৌরসভা',
  'Mirzanagar': 'মির্জানগর', 'Chithalia': 'চিথলিয়া', 'Baksh Mohammad': 'বক্স মাহমুদ',
  'Parshuram Paurashava': 'পরশুরাম পৌরসভা',
  'Fulgazi': 'ফুলগাজী', 'Munshirhat': 'মুন্সিরহাট', 'Darbarpur': 'দরবারপুর',
  'Anandapur': 'আনন্দপুর', 'G.M.Hat': 'জিএমহাট', 'Amjadhat': 'আমজাদহাট',
  'Sarishadi': 'শর্শদি', 'Panchgachhiya': 'পাঁচগাছিয়া', 'Dharmapur': 'ধর্মপুর',
  'Kazirbag': 'কাজিরবাগ', 'Kalidah': 'কালিদহ', 'Baligaon': 'বালিগাঁও',
  'Dhalia': 'ধলিয়া', 'Lemua': 'লেমুয়া', 'Sanua': 'ছনুয়া',
  'Matabi': 'মোটবী', 'Fazilpur': 'ফাজিলপুর', 'Farhadnagar': 'ফরহাদনগর',
  'Feni Paurashava': 'ফেনী পৌরসভা',
  'Char Majlishpur': 'চর মজলিশপুর', 'Bagadana': 'বগাদানা', 'Mangalkandi': 'মঙ্গলকান্দি',
  'Matiganj': 'মতিগঞ্জ', 'Char Darbesh': 'চর দরবেশ', 'Char Chandia': 'চর চান্দিয়া',
  'Sonagazi': 'সোনাগাজী সদর', 'Amirabad': 'আমিরাবাদ', 'Nawabpur': 'নবাবপুর',
  'Sonagazi Paurashava': 'সোনাগাজী পৌরসভা',
};

// ইংরেজি ইউনিয়ন নাম → উপজেলা id
const UNION_UPAZILA = {};
Object.keys(UNIONS_BY_UPAZILA).forEach((upId) => {
  UNIONS_BY_UPAZILA[upId].forEach((u) => { UNION_UPAZILA[u] = upId; });
});

export function getUpazilaById(id) {
  return UPAZILAS.find((u) => u.id === id) || null;
}

export function getUpazilaByName(bnName) {
  return UPAZILAS.find((u) => u.name === bnName) || null;
}

export function getUnionBn(unionEn) {
  return UNION_BN[unionEn] || unionEn;
}

export function getUnionUpazilaId(unionEn) {
  return UNION_UPAZILA[unionEn] || null;
}

// ------------------------------------------------------------
// GeoJSON লোড (একবারই fetch, পরে cache থেকে)
// ------------------------------------------------------------
let _geoPromise = null;

export function loadFeniGeo() {
  if (!_geoPromise) {
    _geoPromise = fetch(GEOJSON_URL)
      .then((r) => {
        if (!r.ok) throw new Error('geojson load failed: ' + r.status);
        return r.json();
      })
      .catch((err) => {
        _geoPromise = null; // পরের বার আবার চেষ্টা করা যাবে
        throw err;
      });
  }
  return _geoPromise;
}

// ------------------------------------------------------------
// ইন্টারনাল জ্যামিতি হেল্পার (GeoJSON কোঅর্ডিনেট = [lng, lat])
// ------------------------------------------------------------
function polygonsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const crosses = (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function pointInPolygon(lng, lat, poly) {
  if (!poly.length || !pointInRing(lng, lat, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) {
    if (pointInRing(lng, lat, poly[h])) return false; // hole-এর ভেতরে
  }
  return true;
}

function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
  }
  return a / 2;
}

function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const f = (ring[j][0] * ring[i][1]) - (ring[i][0] * ring[j][1]);
    a += f;
    cx += (ring[j][0] + ring[i][0]) * f;
    cy += (ring[j][1] + ring[i][1]) * f;
  }
  if (a === 0) return ring[0] ? [ring[0][0], ring[0][1]] : [0, 0];
  return [cx / (3 * a), cy / (3 * a)];
}

function bboxOfPolys(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polys.forEach((poly) => {
    poly[0].forEach((p) => {
      if (p[0] < minX) minX = p[0];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[1] > maxY) maxY = p[1];
    });
  });
  return [minX, minY, maxX, maxY];
}

// প্রতিটা geo অবজেক্টের জন্য একবার ইনডেক্স বানিয়ে cache
const _indexCache = new WeakMap();

function getIndex(geo) {
  let idx = _indexCache.get(geo);
  if (idx) return idx;
  const items = (geo.features || []).map((f) => {
    const name = f.properties && f.properties.shapeName;
    const polys = polygonsOf(f.geometry);
    let area = 0;
    polys.forEach((p) => { area += Math.abs(ringArea(p[0])); });
    return {
      name,
      upazilaId: UNION_UPAZILA[name] || null,
      polys,
      bbox: bboxOfPolys(polys),
      area,
    };
  });
  idx = { items };
  _indexCache.set(geo, idx);
  return idx;
}

// ------------------------------------------------------------
// পাবলিক: কোনো পয়েন্ট ফেনীর কোন ইউনিয়ন/উপজেলায় পড়ে
// রিটার্ন: { union, unionBn, upazilaId, upazilaName, isPaurashava } অথবা null
// (পৌরসভা যদি ইউনিয়নের সাথে ওভারল্যাপ করে, ছোট এলাকাটা জেতে)
// ------------------------------------------------------------
export function findAreaAt(lat, lng, geo) {
  if (!geo || typeof lat !== 'number' || typeof lng !== 'number' || isNaN(lat) || isNaN(lng)) return null;
  const { items } = getIndex(geo);
  let best = null;
  for (const it of items) {
    const b = it.bbox;
    if (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3]) continue;
    const hit = it.polys.some((poly) => pointInPolygon(lng, lat, poly));
    if (hit && (!best || it.area < best.area)) best = it;
  }
  if (!best) return null;
  const up = getUpazilaById(best.upazilaId);
  return {
    union: best.name,
    unionBn: getUnionBn(best.name),
    upazilaId: best.upazilaId,
    upazilaName: up ? up.name : '',
    isPaurashava: /Paurashava$/.test(best.name),
  };
}

export function isInsideFeni(lat, lng, geo) {
  return !!findAreaAt(lat, lng, geo);
}

// ------------------------------------------------------------
// পাবলিক: ফেনীর পুরো বাউন্ডিং বক্স — Leaflet [[south, west], [north, east]]
// ------------------------------------------------------------
export function getFeniBounds(geo, pad = 0.01) {
  const { items } = getIndex(geo);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.forEach((it) => {
    if (it.bbox[0] < minX) minX = it.bbox[0];
    if (it.bbox[1] < minY) minY = it.bbox[1];
    if (it.bbox[2] > maxX) maxX = it.bbox[2];
    if (it.bbox[3] > maxY) maxY = it.bbox[3];
  });
  return [[minY - pad, minX - pad], [maxY + pad, maxX + pad]];
}

// নির্দিষ্ট উপজেলার বাউন্ডিং বক্স — Leaflet [[south, west], [north, east]]
export function getUpazilaBounds(geo, upazilaId, pad = 0.004) {
  const { items } = getIndex(geo);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  items.filter((it) => it.upazilaId === upazilaId).forEach((it) => {
    if (it.bbox[0] < minX) minX = it.bbox[0];
    if (it.bbox[1] < minY) minY = it.bbox[1];
    if (it.bbox[2] > maxX) maxX = it.bbox[2];
    if (it.bbox[3] > maxY) maxY = it.bbox[3];
  });
  if (minX === Infinity) return null;
  return [[minY - pad, minX - pad], [maxY + pad, maxX + pad]];
}

// নির্দিষ্ট উপজেলার ইউনিয়ন feature গুলো (ধাপ ২-এ আঁকার জন্য)
export function getUpazilaFeatures(geo, upazilaId) {
  return (geo.features || []).filter((f) => UNION_UPAZILA[f.properties && f.properties.shapeName] === upazilaId);
}

// ------------------------------------------------------------
// পাবলিক: উপজেলার বাইরের সীমানা (ইউনিয়নগুলোর শেয়ার্ড edge বাদ দিয়ে)
// রিটার্ন: { [upazilaId]: [ [[lat,lng],[lat,lng]], ... ] }
// → Leaflet-এ সরাসরি L.polyline(segments) দেওয়া যায় (multi-polyline)
// ------------------------------------------------------------
const _borderCache = new WeakMap();

export function getUpazilaBorders(geo) {
  const cached = _borderCache.get(geo);
  if (cached) return cached;

  const keyOf = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  // edgeKey → { count per upazila, a, b }
  const edges = new Map();

  (geo.features || []).forEach((f) => {
    const upId = UNION_UPAZILA[f.properties && f.properties.shapeName];
    if (!upId) return;
    polygonsOf(f.geometry).forEach((poly) => {
      poly.forEach((ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i], b = ring[i + 1];
          const ka = keyOf(a), kb = keyOf(b);
          if (ka === kb) continue;
          const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          let e = edges.get(ek);
          if (!e) { e = { a, b, owners: {} }; edges.set(ek, e); }
          e.owners[upId] = (e.owners[upId] || 0) + 1;
        }
      });
    });
  });

  const result = {};
  UPAZILAS.forEach((u) => { result[u.id] = []; });
  edges.forEach((e) => {
    Object.keys(e.owners).forEach((upId) => {
      // এই উপজেলার ভেতরের দুই ইউনিয়নের শেয়ার্ড edge (count ≥ 2) বাদ
      if (e.owners[upId] === 1 && result[upId]) {
        result[upId].push([[e.a[1], e.a[0]], [e.b[1], e.b[0]]]);
      }
    });
  });

  _borderCache.set(geo, result);
  return result;
}

// ------------------------------------------------------------
// পাবলিক: ফেনী জেলার পুরো বাইরের সীমানা (বোল্ড করে আঁকার জন্য)
// রিটার্ন: [ [[lat,lng],[lat,lng]], ... ] — L.polyline(segments) দিয়ে আঁকা যায়
// সব ইউনিয়নের মধ্যে যে edge শুধু একবার এসেছে সেটাই জেলার বাইরের সীমানা।
// ডেটা যাচাই করা: সব edge বন্ধ লুপ হয় (মূল ভূখণ্ড + চরের দ্বীপ + আলাদা
// খণ্ড), কোনো ফাঁক নেই।
// ------------------------------------------------------------
const _districtBorderCache = new WeakMap();

export function getDistrictBorder(geo) {
  const cached = _districtBorderCache.get(geo);
  if (cached) return cached;

  const keyOf = (p) => p[0].toFixed(6) + ',' + p[1].toFixed(6);
  const edges = new Map();

  (geo.features || []).forEach((f) => {
    polygonsOf(f.geometry).forEach((poly) => {
      poly.forEach((ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const a = ring[i], b = ring[i + 1];
          const ka = keyOf(a), kb = keyOf(b);
          if (ka === kb) continue;
          const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
          const e = edges.get(ek);
          if (e) e.n++;
          else edges.set(ek, { a, b, n: 1 });
        }
      });
    });
  });

  const segments = [];
  edges.forEach((e) => {
    if (e.n === 1) segments.push([[e.a[1], e.a[0]], [e.b[1], e.b[0]]]);
  });

  _districtBorderCache.set(geo, segments);
  return segments;
}

// ------------------------------------------------------------
// পাবলিক: নাম বসানোর জন্য লেবেল পয়েন্ট [lat, lng]
// রিটার্ন: { unions: { 'Fulgazi': [lat,lng] }, upazilas: { 'fulgazi': [lat,lng] } }
// ------------------------------------------------------------
const _labelCache = new WeakMap();

// বক্র আকারের এলাকায় সেন্ট্রয়েড বাইরে পড়লে ভেতরের নিকটতম পয়েন্ট
function insidePointNear(polys, cx, cy) {
  if (polys.some((p) => pointInPolygon(cx, cy, p))) return [cx, cy];
  const [minX, minY, maxX, maxY] = bboxOfPolys(polys);
  const N = 24;
  let best = null, bestD = Infinity;
  for (let i = 0; i <= N; i++) {
    for (let j = 0; j <= N; j++) {
      const x = minX + ((maxX - minX) * i) / N;
      const y = minY + ((maxY - minY) * j) / N;
      if (polys.some((p) => pointInPolygon(x, y, p))) {
        const d = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        if (d < bestD) { bestD = d; best = [x, y]; }
      }
    }
  }
  return best || [cx, cy];
}

export function getLabelPoints(geo) {
  const cached = _labelCache.get(geo);
  if (cached) return cached;

  const { items } = getIndex(geo);
  const unions = {};
  const sums = {}; // upazilaId → { x, y, w, bigName, bigArea }

  items.forEach((it) => {
    if (!it.polys.length) return;
    // সবচেয়ে বড় পলিগনের সেন্ট্রয়েড
    let big = it.polys[0];
    it.polys.forEach((p) => { if (Math.abs(ringArea(p[0])) > Math.abs(ringArea(big[0]))) big = p; });
    const c = ringCentroid(big[0]);
    const pt = insidePointNear(it.polys, c[0], c[1]);
    unions[it.name] = [pt[1], pt[0]];

    if (it.upazilaId) {
      const s = sums[it.upazilaId] || (sums[it.upazilaId] = { x: 0, y: 0, w: 0, bigName: null, bigArea: 0 });
      s.x += pt[0] * it.area;
      s.y += pt[1] * it.area;
      s.w += it.area;
      if (it.area > s.bigArea) { s.bigArea = it.area; s.bigName = it.name; }
    }
  });

  const upazilas = {};
  Object.keys(sums).forEach((upId) => {
    const s = sums[upId];
    const mx = s.x / s.w, my = s.y / s.w;
    // গড় বিন্দু যদি অন্য উপজেলায় পড়ে, সবচেয়ে বড় ইউনিয়নের পয়েন্ট নিই
    const hit = findAreaAt(my, mx, geo);
    if (hit && hit.upazilaId === upId) {
      upazilas[upId] = [my, mx];
    } else {
      upazilas[upId] = unions[s.bigName];
    }
  });

  const out = { unions, upazilas };
  _labelCache.set(geo, out);
  return out;
}

// ------------------------------------------------------------
// বাংলাদেশ (দেশ-ভিউ): লোড + বর্ডার + মাস্ক + বাউন্ডস
// ------------------------------------------------------------
let _bdPromise = null;

export function loadBangladeshGeo() {
  if (!_bdPromise) {
    _bdPromise = fetch(BANGLADESH_URL)
      .then((r) => {
        if (!r.ok) throw new Error('bangladesh geojson load failed: ' + r.status);
        return r.json();
      })
      .catch((err) => {
        _bdPromise = null; // পরের বার আবার চেষ্টা করা যাবে
        throw err;
      });
  }
  return _bdPromise;
}

// দেশের বাইরের রিংগুলো (ভেতরের hole বাদ), Leaflet [lat, lng] ফরম্যাটে
const _bdRingsCache = new WeakMap();

export function getBangladeshRings(geo) {
  const cached = _bdRingsCache.get(geo);
  if (cached) return cached;
  const rings = [];
  (geo.features || []).forEach((f) => {
    polygonsOf(f.geometry).forEach((poly) => {
      if (poly[0] && poly[0].length > 1) {
        rings.push(poly[0].map((p) => [p[1], p[0]]));
      }
    });
  });
  _bdRingsCache.set(geo, rings);
  return rings;
}

// মাস্ক: পুরো পৃথিবীর আয়তক্ষেত্র + বাংলাদেশের রিংগুলো (hole হিসেবে)।
// L.polygon-এ fillRule: 'evenodd' দিলে শুধু বাংলাদেশের বাইরের অংশ ঢাকা পড়ে।
const _bdMaskCache = new WeakMap();

export function getBangladeshMask(geo) {
  const cached = _bdMaskCache.get(geo);
  if (cached) return cached;
  const world = [[-85, -180], [-85, 180], [85, 180], [85, -180]];
  const mask = [world].concat(getBangladeshRings(geo));
  _bdMaskCache.set(geo, mask);
  return mask;
}

// Leaflet [[south, west], [north, east]] — দেশ নেই/খালি হলে null
export function getBangladeshBounds(geo) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  getBangladeshRings(geo).forEach((ring) => {
    ring.forEach((p) => {
      if (p[1] < minX) minX = p[1];
      if (p[1] > maxX) maxX = p[1];
      if (p[0] < minY) minY = p[0];
      if (p[0] > maxY) maxY = p[0];
    });
  });
  if (minX === Infinity) return null;
  return [[minY, minX], [maxY, maxX]];
}