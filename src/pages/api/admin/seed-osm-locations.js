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
// Overpass কয়েকটা ছোট গ্রুপে ভাগ করে একটা একটা করে আনা হয় (একটা বড় কোয়েরি সার্ভারে
// টাইমআউট/ব্যর্থ হতো)। প্রতি গ্রুপ আনার পরই ডাটাবেসে সেভ — মাঝপথে একটা গ্রুপ ব্যর্থ হলেও
// বাকিগুলোর কাজ হারায় না। ব্যর্থ গ্রুপের নাম ও কারণ রেসপন্সে (failedGroups) আসে।
// রেসপন্সে Overpass-এর "remark: runtime error" (সার্ভার টাইমআউট/ব্যস্ত) ধরা হয়।
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
const ATTEMPT_TIMEOUT_MS = 25000; // প্রতি সার্ভার-চেষ্টা
const TOTAL_BUDGET_MS = 100000; // এর বেশি সময় গেলে বাকি গ্রুপ থামিয়ে pendingGroups-এ জানায়
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

// ছোট ছোট গ্রুপ — প্রতিটা আলাদা Overpass কোয়েরি (হালকা, দ্রুত)
const GROUPS = [
  {
    key: 'food_hotel',
    filters: [
      `nwr["amenity"~"^(restaurant|fast_food|cafe)$"]`,
      `nwr["tourism"~"^(hotel|guest_house)$"]`,
    ],
  },
  {
    key: 'health_education',
    filters: [
      `nwr["amenity"~"^(hospital|clinic|doctors|pharmacy|school|college|university|kindergarten|library)$"]`,
    ],
  },
  {
    key: 'market_bank_transport',
    filters: [
      `nwr["amenity"~"^(marketplace|bank|bus_station|ferry_terminal|fuel)$"]`,
      `nwr["shop"~"^(mall|supermarket|department_store|marketplace)$"]`,
      `nwr["railway"~"^(station|halt)$"]`,
    ],
  },
  {
    key: 'public_worship_leisure',
    filters: [
      `nwr["amenity"~"^(police|fire_station|post_office|townhall|courthouse|community_centre|place_of_worship|cinema)$"]`,
      `nwr["office"="government"]`,
      `nwr["tourism"~"^(attraction|museum|viewpoint)$"]`,
      `nwr["leisure"~"^(park|stadium|sports_centre)$"]`,
    ],
  },
  {
    key: 'places',
    filters: [`nwr["place"~"^(city|town|village|suburb|hamlet|neighbourhood|quarter|locality)$"]`],
  },
];

function buildQuery(group) {
  const body = group.filters.map((f) => `  ${f}${NAMED}(${BBOX});`).join('\n');
  return `[out:json][timeout:25];\n(\n${body}\n);\nout center;`;
}

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

// একটা গ্রুপের কোয়েরি চালানো। রিটার্ন: { elements | null, attempts: [কারণের তালিকা] }
async function fetchGroup(group) {
  const query = buildQuery(group);
  const attempts = [];

  for (const endpoint of OVERPASS_ENDPOINTS) {
    const host = new URL(endpoint).host;
    const t0 = Date.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'User-Agent': 'SmartFeni-LocationSeed/2.1 (info@smartfeni.com)',
        },
        body: query,
        signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
      });
      const ms = Date.now() - t0;

      if (!res.ok) {
        attempts.push(`${host}: HTTP ${res.status} (${ms}ms)`);
        continue;
      }

      const text = await res.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        attempts.push(`${host}: JSON নয় — ${text.slice(0, 80).replace(/\s+/g, ' ')} (${ms}ms)`);
        continue;
      }

      const elements = Array.isArray(parsed.elements) ? parsed.elements : [];
      // সার্ভার টাইমআউট/ব্যস্ত হলে Overpass 200 দেয় কিন্তু remark-এ runtime error লেখে
      if (parsed.remark && /runtime error|timed out|out of memory/i.test(String(parsed.remark))) {
        attempts.push(`${host}: ${String(parsed.remark).slice(0, 100)} (${ms}ms)`);
        if (elements.length === 0) continue;
      }
      return { elements, attempts };
    } catch (e) {
      attempts.push(`${host}: ${e?.name || 'Error'} ${String(e?.message || '').slice(0, 80)} (${Date.now() - t0}ms)`);
    }
  }
  return { elements: null, attempts };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  try {
    const startedAt = Date.now();
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

    // ঐচ্ছিক বডি: { "groups": ["places", "health_education"] } — শুধু ওই গ্রুপগুলো চালাতে।
    // বডি না থাকলে (এখনকার অ্যাডমিন পেজ) সব গ্রুপ চলে।
    let wanted = null;
    try {
      const body = await request.json();
      if (body && Array.isArray(body.groups)) wanted = body.groups.map(String);
    } catch (e) {
      /* বডি নেই — সব গ্রুপ */
    }
    const groupsToRun = wanted ? GROUPS.filter((g) => wanted.includes(g.key)) : GROUPS;

    const geo = await loadFeniGeoServer();

    let totalFromOsm = 0;
    let skippedNoName = 0;
    let outsideFeni = 0;
    let duplicates = 0;
    let inserted = 0;
    let failed = 0;
    let firstError = null;
    const breakdown = {};
    const failedGroups = []; // { group, attempts }
    const pendingGroups = [];
    const seenIds = new Set();
    const seenSpots = new Set(); // একই নাম + কাছাকাছি জায়গা (node + way ডুপ্লিকেট) এড়াতে

    for (const group of groupsToRun) {
      if (Date.now() - startedAt > TOTAL_BUDGET_MS) {
        pendingGroups.push(group.key);
        continue;
      }

      const { elements, attempts } = await fetchGroup(group);
      if (!elements) {
        failedGroups.push({ group: group.key, attempts });
        continue;
      }
      totalFromOsm += elements.length;

      const rows = [];
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
        if (seenIds.has(externalId) || seenSpots.has(spotKey)) {
          duplicates++;
          continue;
        }
        seenIds.add(externalId);
        seenSpots.add(spotKey);

        const cat = categorize(tags);
        breakdown[cat] = (breakdown[cat] || 0) + 1;

        rows.push({ external_id: externalId, name, lat, lng, upazila, source: 'osm' });
      }

      // এই গ্রুপ সাথে সাথে সেভ — ব্যাচে upsert; ব্যাচ ব্যর্থ হলে একটা একটা করে চেষ্টা
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const chunk = rows.slice(i, i + BATCH_SIZE);
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
    }

    // সব গ্রুপ ব্যর্থ — কারণসহ এরর (অ্যাডমিন পেজ error টেক্সটই দেখায়)
    if (failedGroups.length === groupsToRun.length && groupsToRun.length > 0) {
      const detail = failedGroups
        .slice(0, 2)
        .map((g) => `${g.group} → ${g.attempts.join(' | ')}`)
        .join(' ; ');
      return json(
        { error: 'Overpass API থেকে ডাটা আনতে ব্যর্থ। কারণ: ' + detail, failedGroups },
        502
      );
    }

    return json({
      success: true,
      totalFromOsm,
      inserted,
      skippedNoName,
      failed,
      outsideFeni,
      duplicates,
      geoFilter: !!geo,
      breakdown,
      failedGroups,
      pendingGroups,
      firstError,
      seconds: Math.round((Date.now() - startedAt) / 1000),
    });
  } catch (err) {
    return json({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }, 500);
  }
}
