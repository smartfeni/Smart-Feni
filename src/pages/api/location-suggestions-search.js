// ============================================================
// API এন্ডপয়েন্ট: লোকেশন সাজেশন সার্চ (/api/location-suggestions-search)
// শুধু Delivery Hero পিকআপ টেক্সট বক্সের অটোকমপ্লিট-এর জন্য।
//
// কীভাবে কাজ করে:
// ১. প্রথমে নিজেদের location_suggestions টেবিলে সার্চ (ফ্রি, দ্রুত)
// ২. রেজাল্ট কম পেলে Photon (OpenStreetMap) থেকে লোকেশন খোঁজে;
//    Feni-র কেন্দ্রকে bias হিসেবে ব্যবহার করে, query-তে জোর করে জেলা যোগ করে না।
//
// GET /api/location-suggestions-search?q=নবী+হোটেল
// রেসপন্স: { results: [{ id, name, lat, lng, upazila, image_url, source }] }
// ============================================================

import { createClient } from '@supabase/supabase-js';
// এরর মনিটরিং (ধাপ ৯): ৫০০ পথ ও গিলে-ফেলা এরর অ্যাডমিন এরর লগে রিপোর্ট হয়
import { reportServerError } from '../../lib/serverErrorReporter.js';

export const prerender = false;


function getAdminClient() {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) return null;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function searchLocalSuggestions(supabaseAdmin, q, limit = 8) {
  const { data, error } = await supabaseAdmin
    .from('location_suggestions')
    .select('id, name, lat, lng, upazila, image_url, source')
    .ilike('name_normalized', `%${q.toLowerCase()}%`)
    .limit(limit);

  if (error) {
    await reportServerError(supabaseAdmin, {
      route: '/api/location-suggestions-search',
      action: 'location_search_local',
      title: 'লোকেশন সার্চ: নিজেদের DB সার্চ ব্যর্থ',
      message: error.message,
      code: error.code,
      status: 200,
    });
    return [];
  }
  return data || [];
}

// Photon (OpenStreetMap-based) search fallback. Bias results toward Feni
// without appending administrative text to the user's query (which can
// otherwise cause Photon to return only district/upazila matches).
async function searchPhoton(q) {
  const queries = [q, `${q} Feni`];
  const collected = new Map();

  for (const searchText of queries) {
    try {
      const params = new URLSearchParams({
        q: searchText,
        lat: '23.0159',
        lon: '91.3976',
        limit: '15',
      });
      const response = await fetch(`https://photon.komoot.io/api/?${params.toString()}`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) continue;

      const payload = await response.json();
      for (const feature of payload.features || []) {
        const properties = feature.properties || {};
        const coordinates = feature.geometry?.coordinates || [];
        const lng = Number(coordinates[0]);
        const lat = Number(coordinates[1]);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        // Keep fallback results inside the Feni service area.
        if (lat < 22.65 || lat > 23.35 || lng < 91.0 || lng > 91.65) continue;

        const name = properties.name || properties.street || properties.locality ||
          properties.district || properties.city || properties.county;
        if (!name) continue;

        const addressParts = [
          properties.name,
          properties.street,
          properties.neighbourhood,
          properties.suburb,
          properties.village,
          properties.hamlet,
          properties.town,
          properties.city,
          properties.county,
          properties.district,
          properties.state,
          properties.country,
        ].filter((value, index, all) => value && all.indexOf(value) === index);

        const item = {
          id: `photon-${properties.osm_type || 'place'}-${properties.osm_id || lat + '-' + lng}`,
          name,
          lat,
          lng,
          upazila: properties.county || properties.district || null,
          image_url: null,
          source: 'photon',
          display_name: addressParts.join(', '),
        };
        collected.set(item.id, item);
      }
    } catch {
      // Continue with the next query if the public Photon endpoint is unavailable.
    }
  }

  const normalizedQuery = q.toLocaleLowerCase().replace(/[\\s\\u200c\\u200d]+/g, '');
  return [...collected.values()].sort((a, b) => {
    const aName = String(a.name).toLocaleLowerCase().replace(/[\\s\\u200c\\u200d]+/g, '');
    const bName = String(b.name).toLocaleLowerCase().replace(/[\\s\\u200c\\u200d]+/g, '');
    const score = (name) => name === normalizedQuery ? 0 : name.startsWith(normalizedQuery) ? 1 : name.includes(normalizedQuery) ? 2 : 3;
    return score(aName) - score(bName);
  });
}

export async function GET({ url }) {
  // এরর রিপোর্টের client: service role client তৈরির পর সেট হয়
  let reportDb = null;
  try {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = getAdminClient();
    reportDb = supabaseAdmin;
    if (!supabaseAdmin) {
      return new Response(JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let results = await searchLocalSuggestions(supabaseAdmin, q);

    // Photon is queried even when the local DB has a few broad administrative
    // matches, so a specific village/market/bridge can still appear.
    const photonResults = await searchPhoton(q);
    const seen = new Set(results.map((item) => `${Number(item.lat).toFixed(5)},${Number(item.lng).toFixed(5)}`));
    for (const item of photonResults) {
      const key = `${Number(item.lat).toFixed(5)},${Number(item.lng).toFixed(5)}`;
      if (!seen.has(key)) {
        results.push(item);
        seen.add(key);
      }
    }

    // Put exact and partial name matches ahead of broad district/upazila entries.
    const normalizedQuery = q.toLocaleLowerCase().replace(/[\\s\\u200c\\u200d]+/g, '');
    results.sort((a, b) => {
      const score = (item) => {
        const name = String(item.name || '').toLocaleLowerCase().replace(/[\\s\\u200c\\u200d]+/g, '');
        return name === normalizedQuery ? 0 : name.startsWith(normalizedQuery) ? 1 : name.includes(normalizedQuery) ? 2 : 3;
      };
      return score(a) - score(b);
    });
    results = results.slice(0, 8);

    return new Response(JSON.stringify({ results: results.slice(0, 8) }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
      },
    });
  } catch (err) {
    await reportServerError(reportDb, {
      route: '/api/location-suggestions-search',
      action: 'location_search_unexpected',
      title: 'লোকেশন সার্চ: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}