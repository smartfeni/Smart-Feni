// ============================================================
// API এন্ডপয়েন্ট: লোকেশন সাজেশন সার্চ (/api/location-suggestions-search)
// শুধু Delivery Hero পিকআপ টেক্সট বক্সের অটোকমপ্লিট-এর জন্য।
//
// কীভাবে কাজ করে:
// ১. প্রথমে নিজেদের location_suggestions টেবিলে ilike সার্চ (ফ্রি, দ্রুত)
// ২. রেজাল্ট কম পেলে (৫টার কম) Google Places Text Search API দিয়ে
//    ফেনী এলাকায় fallback সার্চ করে
// ৩. Google থেকে পাওয়া নতুন জায়গা DB-তে ক্যাশ করে সেভ করে রাখা হয়
//    (ছবি থাকলে সেটাও একবার fetch করে নিজেদের Supabase storage-এ
//    আপলোড করে রাখা হয়) — পরের বার একই জায়গা খুঁজলে আর Google-কে
//    কল করতে হবে না, ফ্রি নিজেদের DB থেকেই সার্ভ হবে।
//
// GET /api/location-suggestions-search?q=নবী+হোটেল
// রেসপন্স: { results: [{ id, name, lat, lng, upazila, image_url, source }] }
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const FENI_CENTER = { lat: 23.0159, lng: 91.3976 };
const FENI_RADIUS_METERS = 40000; // ৪০ কিমি — memory-র ফলব্যাক রেডিয়াসের সাথে মিলিয়ে

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

  if (error) return [];
  return data || [];
}

// Google Place Photo রেফারেন্স থেকে ছবি টেনে Supabase storage-এ আপলোড করা।
// ব্যর্থ হলে null রিটার্ন করে — ছবি ছাড়াই এন্ট্রি সেভ হবে, পুরো রিকোয়েস্ট আটকাবে না।
async function cachePhoto(supabaseAdmin, photoReference, placeId, apiKey) {
  try {
    const photoRes = await fetch(
      `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoReference}&key=${apiKey}`
    );
    if (!photoRes.ok) return null;

    const contentType = photoRes.headers.get('content-type') || 'image/jpeg';
    const ext = contentType.includes('png') ? 'png' : 'jpg';
    const buffer = await photoRes.arrayBuffer();
    const path = `google/${placeId}.${ext}`;

    const { error: uploadError } = await supabaseAdmin.storage
      .from('location-images')
      .upload(path, buffer, { contentType, upsert: true });

    if (uploadError) return null;

    const { data: publicUrlData } = supabaseAdmin.storage
      .from('location-images')
      .getPublicUrl(path);

    return publicUrlData?.publicUrl || null;
  } catch {
    return null;
  }
}

async function fallbackGooglePlaces(supabaseAdmin, q, apiKey) {
  try {
    const params = new URLSearchParams({
      query: `${q}, Feni, Bangladesh`,
      location: `${FENI_CENTER.lat},${FENI_CENTER.lng}`,
      radius: String(FENI_RADIUS_METERS),
      key: apiKey,
    });
    const res = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?${params}`);
    const data = await res.json();

    if (data.status !== 'OK' || !Array.isArray(data.results)) return [];

    const candidates = data.results.slice(0, 5);
    const saved = [];

    for (const place of candidates) {
      if (!place.place_id || !place.geometry?.location) continue;

      let imageUrl = null;
      const photoReference = place.photos?.[0]?.photo_reference;
      if (photoReference) {
        imageUrl = await cachePhoto(supabaseAdmin, photoReference, place.place_id, apiKey);
      }

      // একই জায়গা আগেই কেউ সার্চ করে ক্যাশ করেছে কিনা চেক (external_id ইউনিক)
      const { data: upserted, error: upsertError } = await supabaseAdmin
        .from('location_suggestions')
        .upsert(
          {
            external_id: place.place_id,
            name: place.name,
            lat: place.geometry.location.lat,
            lng: place.geometry.location.lng,
            upazila: null,
            image_url: imageUrl,
            source: 'google',
          },
          { onConflict: 'external_id', ignoreDuplicates: false }
        )
        .select('id, name, lat, lng, upazila, image_url, source')
        .single();

      if (!upsertError && upserted) saved.push(upserted);
    }

    return saved;
  } catch {
    return [];
  }
}

export async function GET({ url }) {
  try {
    const q = (url.searchParams.get('q') || '').trim();
    if (q.length < 2) {
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseAdmin = getAdminClient();
    if (!supabaseAdmin) {
      return new Response(JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    let results = await searchLocalSuggestions(supabaseAdmin, q);

    const googleApiKey = import.meta.env.GOOGLE_PLACES_API_KEY;
    if (results.length < 5 && googleApiKey) {
      const googleResults = await fallbackGooglePlaces(supabaseAdmin, q, googleApiKey);
      // ডুপ্লিকেট বাদ দিয়ে merge করা (id ধরে)
      const existingIds = new Set(results.map((r) => r.id));
      for (const g of googleResults) {
        if (!existingIds.has(g.id)) results.push(g);
      }
    }

    return new Response(JSON.stringify({ results: results.slice(0, 8) }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}