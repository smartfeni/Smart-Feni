// path: src/pages/api/admin/seed-osm-locations.js
// ============================================================
// API এন্ডপয়েন্ট: OSM থেকে লোকেশন সিড (/api/admin/seed-osm-locations)
// শুধু admin রোল কল করতে পারবে। এককালীন/বারবার চালানো যায় —
// external_id (osm/{type}/{id}) দিয়ে upsert হয়, তাই দ্বিতীয়বার
// চালালে ডুপ্লিকেট হবে না, শুধু নতুন জায়গা থাকলে যোগ হবে।
//
// সোর্স: OpenStreetMap Overpass API (ফ্রি, কোনো key লাগে না)।
//
// কী কী আনে (শুধু নাম-ট্যাগ করা জায়গা):
//   খাবার (রেস্টুরেন্ট/ফাস্ট-ফুড/ক্যাফে), হোটেল/গেস্ট হাউস, বাজার/মার্কেট/মল/সুপারশপ,
//   হাসপাতাল/ক্লিনিক/ডাক্তার/ফার্মেসি, স্কুল/কলেজ/বিশ্ববিদ্যালয়/লাইব্রেরি, ব্যাংক,
//   বাসস্ট্যান্ড/রেলস্টেশন/ফেরিঘাট, মসজিদ/মন্দির ইত্যাদি (place_of_worship),
//   থানা/ডাকঘর/ফায়ার স্টেশন/টাউন হল/কোর্ট/সরকারি অফিস, পেট্রোল পাম্প, পার্ক/স্টেডিয়াম,
//   এবং এলাকা/গ্রাম/মহল্লা/মোড় (place=*)।
//
// নাম: আগে বাংলা নাম (name:bn), না থাকলে সাধারণ name।
// ফেনীর বাইরের জায়গা বাদ: public/data/feni_unions.geojson দিয়ে পয়েন্ট-ইন-পলিগন চেক
// (ভারতের ত্রিপুরা ও পাশের জেলার জায়গা bounding box-এ ঢুকে পড়ে, সেগুলো বাদ যায়)।
// উপজেলাও সঠিকভাবে বসে (ইউনিয়ন পলিগন থেকে), geojson লোড না হলে আগের মতো
// নিকটতম উপজেলা কেন্দ্র ও কোনো ফিল্টার ছাড়া চলে (geoFilter: false)।
//
// image_url ইচ্ছাকৃতভাবে upsert-এ নেই — অ্যাডমিন হাতে ছবি দিলে রিসিডে মুছে যাবে না।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { findAreaAt } from '../../../data/feniAreas.js';

export const prerender = false;

// Vercel-এ request.url-এর origin localhost হয় — তাই হার্ডকোড
const SITE_URL = 'https://smartfeni.com';
const GEOJSON_URL = `${SITE_URL}/data/feni_unions.geojson`;

const BATCH_SIZE = 200;
const MAX_NAME_LENGTH = 120;

// প্রধান সার্ভার ব্যর্থ/ব্যস্ত হলে পরেরটায় চেষ্টা
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// ফেনীর ৬ উপজেলার কোঅর্ডিনেট (services.js-এর সাথে মিলিয়ে) —
// শুধু geojson লোড না হলে নিকটতম উপজেলা বের করতে ব্যবহার হবে
const UPAZILAS = [
  { name: 'ফেনী সদর', lat: 23.0159, lng: 91.3976 },
  { name: 'ছাগলনাইয়া', lat: 23.0389, lng: 91.5194 },
  { name: 'দাগনভূঞা', lat: 22.9833, lng: 91.1833 },
  { name: 'পরশুরাম', lat: 23.225, lng: 91.45 },
  { name: 'ফুলগাজী', lat: 23.07, lng: 91.45 },
  { name: 'সোনাগাজী', lat: 22.85, lng: 91.3917 },
];

// ফেনী জেলা কভার করার জন্য একটু মার্জিনসহ bounding box (south, west, north, east)
const BBOX = '22.72,91.02,23.30,91.58';

// শুধু নাম আছে এমন জায়গা (name বা name:bn)
const NAMED = '[~"^name(:bn)?$"~"."]';

const AMENITIES = [
  'restaurant', 'fast_food', 'cafe', 'marketplace',
  'hospital', 'clinic', 'doctors', 'pharmacy',
  'school', 'college', 'university', 'kindergarten', 'library',
  'bank', 'bus_station', 'ferry_terminal', 'fuel',
  'police', 'fire_station', 'post_office', 'townhall', 'courthouse', 'community_centre',
  'place_of_worship', 'cinema',
].join('|');
const SHOPS = 'mall|supermarket|department_store|marketplace';
const TOURISM = 'hotel|guest_house|attraction|museum|viewpoint';
const LEISURE = 'park|stadium|sports_centre';
const PLACES = 'city|town|village|suburb|hamlet|neighbourhood|quarter|locality';

const OVERPASS_QUERY = `
[out:json][timeout:50];
(
  nwr["amenity"~"^(${AMENITIES})$"]${NAMED}(${BBOX});
  nwr["shop"~"^(${SHOPS})$"]${NAMED}(${BBOX});
  nwr["tourism"~"^(${TOURISM})$"]${NAMED}(${BBOX});
  nwr["leisure"~"^(${LEISURE})$"]${NAMED}(${BBOX});
  nwr["railway"~"^(station|halt)$"]${NAMED}(${BBOX});
  nwr["office"="government"]${NAMED}(${BBOX});
  nwr["place"~"^(${PLACES})$"]${NAMED}(${BBOX});
);
out center;
`;

function nearestUpazila(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  for (const u of UPAZILAS) {
    const d = (u.lat - lat) ** 2 + (u.lng - lng) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = u.name;
    }
  }
  return best;
}

// শুধু রেসপন্সের পরিসংখ্যানের জন্য (ডাটাবেসে সেভ হয় না — টেবিলে kind কলাম নেই)
function categorize(tags) {
  if (tags.place) return 'place';
  const a = tags.amenity;
  if (a) {
    if (/^(restaurant|fast_food|cafe)$/.test(a)) return 'food';
    if (a === 'marketplace') return 'market';
    if (/^(hospital|clinic|doctors|pharmacy)$/.test(a)) return 'health';
    if (/^(school|college|university|kindergarten|library)$/.test(a)) return 'education';
    if (a === 'bank') return 'bank';
    if (/^(bus_station|ferry_terminal)$/.test(a)) return 'transport';
    if (a === 'place_of_worship') return 'worship';
    if (a === 'fuel') return 'fuel';
    if (a === 'cinema') return 'leisure';
    return 'public';
  }
  if (tags.shop) return /marketplace/.test(tags.shop) ? 'market' : 'shop';
  if (tags.tourism) return /^(hotel|guest_house)$/.test(tags.tourism) ? 'hotel' : 'attraction';
  if (tags.leisure) return 'leisure';
  if (tags.railway) return 'transport';
  if (tags.office) return 'public';
  return 'other';
}

async function verifyAdmin(request, supabaseAdmin) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return null;

  const { data: callerData, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !callerData?.user) return null;

  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', callerData.user.id)
    .single();

  if (!profile || profile.role !== 'admin') return null;
  return callerData.user;
}

// ফেনীর geojson (বাইরের জায়গা ছাঁটা + সঠিক উপজেলার জন্য)। ব্যর্থ হলে null।
async function loadFeniGeoServer() {
  try {
    const res = await fetch(GEOJSON_URL);
    if (!res.ok) return null;
    const geo = await res.json();
    return geo && Array.isArray(geo.features) ? geo : null;
  } catch (e) {
    return null;
  }
}

async function fetchOverpass() {
  let lastStatus = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'SmartFeni-LocationSeed/2.0 (info@smartfeni.com)',
        },
        body: OVERPASS_QUERY,
        signal: AbortSignal.timeout(55000),
      });
      if (res.ok) return { data: await res.json(), status: 200 };
      lastStatus = res.status;
    } catch (e) {
      lastStatus = 'network';
    }
  }
  return { data: null, status: lastStatus };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  try {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const admin = await verifyAdmin(request, supabaseAdmin);
    if (!admin) {
      return json({ error: 'শুধু অ্যাডমিন এই কাজ করতে পারবেন' }, 403);
    }

    // geojson আর Overpass একসাথে আনা
    const [geo, overpass] = await Promise.all([loadFeniGeoServer(), fetchOverpass()]);

    if (!overpass.data) {
      return json(
        { error: 'Overpass API থেকে ডাটা আনতে ব্যর্থ (স্ট্যাটাস: ' + overpass.status + ')। একটু পরে আবার চেষ্টা করুন।' },
        502
      );
    }

    const elements = overpass.data.elements || [];

    let skippedNoName = 0;
    let outsideFeni = 0;
    let duplicates = 0;
    const breakdown = {};
    const rows = new Map(); // external_id -> row
    const seenSpots = new Set(); // একই নাম + কাছাকাছি জায়গা (node + way ডুপ্লিকেট) এড়াতে

    for (const el of elements) {
      const tags = el.tags || {};
      const name = String(tags['name:bn'] || tags.name || '').trim().slice(0, MAX_NAME_LENGTH);
      const lat = el.type === 'node' ? el.lat : el.center?.lat;
      const lng = el.type === 'node' ? el.lon : el.center?.lon;

      if (!name || typeof lat !== 'number' || typeof lng !== 'number') {
        skippedNoName++;
        continue;
      }

      let upazila;
      if (geo) {
        const area = findAreaAt(lat, lng, geo);
        if (!area) {
          outsideFeni++;
          continue;
        }
        upazila = area.upazilaName || nearestUpazila(lat, lng);
      } else {
        upazila = nearestUpazila(lat, lng);
      }

      const externalId = `osm/${el.type}/${el.id}`;
      const spotKey = `${name.toLowerCase()}|${lat.toFixed(3)}|${lng.toFixed(3)}`;
      if (rows.has(externalId) || seenSpots.has(spotKey)) {
        duplicates++;
        continue;
      }
      seenSpots.add(spotKey);

      const cat = categorize(tags);
      breakdown[cat] = (breakdown[cat] || 0) + 1;

      rows.set(externalId, {
        external_id: externalId,
        name,
        lat,
        lng,
        upazila,
        source: 'osm',
      });
    }

    // ব্যাচে upsert (দ্রুত); কোনো ব্যাচ ব্যর্থ হলে একটা একটা করে চেষ্টা করে খারাপ রো আলাদা করা
    const all = Array.from(rows.values());
    let inserted = 0;
    let failed = 0;
    let firstError = null;

    for (let i = 0; i < all.length; i += BATCH_SIZE) {
      const chunk = all.slice(i, i + BATCH_SIZE);
      const { error } = await supabaseAdmin
        .from('location_suggestions')
        .upsert(chunk, { onConflict: 'external_id', ignoreDuplicates: false });

      if (!error) {
        inserted += chunk.length;
        continue;
      }

      for (const row of chunk) {
        const { error: rowError } = await supabaseAdmin
          .from('location_suggestions')
          .upsert(row, { onConflict: 'external_id', ignoreDuplicates: false });
        if (rowError) {
          failed++;
          if (!firstError) firstError = rowError.message;
        } else {
          inserted++;
        }
      }
    }

    return json({
      success: true,
      totalFromOsm: elements.length,
      inserted,
      skippedNoName,
      failed,
      outsideFeni,
      duplicates,
      geoFilter: !!geo,
      breakdown,
      firstError,
    });
  } catch (err) {
    return json({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }, 500);
  }
}
