// ============================================================
// API এন্ডপয়েন্ট: OSM থেকে লোকেশন সিড (/api/admin/seed-osm-locations)
// শুধু admin রোল কল করতে পারবে। এককালীন/বারবার চালানো যায় —
// external_id (osm/{type}/{id}) দিয়ে upsert হয়, তাই দ্বিতীয়বার
// চালালে ডুপ্লিকেট হবে না, শুধু নতুন POI থাকলে যোগ হবে।
//
// সোর্স: OpenStreetMap Overpass API (ফ্রি, কোনো key লাগে না) —
// ফেনী জেলার bounding box-এর ভেতরে রেস্টুরেন্ট/ফাস্ট-ফুড/ক্যাফে/হোটেল
// টাইপের POI খুঁজে আনে।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// ফেনী জেলার ৬ উপজেলার কোঅর্ডিনেট (services.js-এর সাথে মিলিয়ে) —
// নিকটতম উপজেলা বের করতে ব্যবহার হবে
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

const OVERPASS_QUERY = `
[out:json][timeout:60];
(
  node["amenity"~"restaurant|fast_food|cafe"](${BBOX});
  way["amenity"~"restaurant|fast_food|cafe"](${BBOX});
  node["tourism"="hotel"](${BBOX});
  way["tourism"="hotel"](${BBOX});
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

export async function POST({ request }) {
  try {
    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const admin = await verifyAdmin(request, supabaseAdmin);
    if (!admin) {
      return new Response(JSON.stringify({ error: 'শুধু অ্যাডমিন এই কাজ করতে পারবেন' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const overpassRes = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'User-Agent': 'SmartFeni-LocationSeed/1.0 (info@smartfeni.com)',
      },
      body: OVERPASS_QUERY,
    });

    if (!overpassRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Overpass API থেকে ডাটা আনতে ব্যর্থ (স্ট্যাটাস: ' + overpassRes.status + ')' }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const overpassData = await overpassRes.json();
    const elements = overpassData.elements || [];

    let inserted = 0;
    let skippedNoName = 0;
    let failed = 0;

    for (const el of elements) {
      const name = el.tags?.name || el.tags?.['name:bn'];
      if (!name) {
        skippedNoName++;
        continue;
      }

      const lat = el.type === 'node' ? el.lat : el.center?.lat;
      const lng = el.type === 'node' ? el.lon : el.center?.lon;
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        skippedNoName++;
        continue;
      }

      const { error: upsertError } = await supabaseAdmin.from('location_suggestions').upsert(
        {
          external_id: `osm/${el.type}/${el.id}`,
          name,
          lat,
          lng,
          upazila: nearestUpazila(lat, lng),
          image_url: null,
          source: 'osm',
        },
        { onConflict: 'external_id', ignoreDuplicates: false }
      );

      if (upsertError) failed++;
      else inserted++;
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalFromOsm: elements.length,
        inserted,
        skippedNoName,
        failed,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
