// path: src/pages/api/location-suggestions-nearby.js
// ============================================================
// API এন্ডপয়েন্ট: ম্যাপে দেখা এলাকার (bounding box) নামসহ জায়গা
// (/api/location-suggestions-nearby)
//
// LocationPicker ম্যাপে জুম ১৫+ হলে এই এলাকার ল্যান্ডমার্ক (বাজার, স্কুল, হাসপাতাল,
// মসজিদ, দোকান ইত্যাদি) নামের চিপ হিসেবে আঁকার জন্য। location_suggestions
// টেবিল থেকে পড়ে (OSM সিড + গুগল ক্যাশ + ইউজারের নাম-দেওয়া পিন)।
//
// GET /api/location-suggestions-nearby?south=23.00&west=91.38&north=23.03&east=91.41&limit=150
// রেসপন্স: { results: [{ id, name, lat, lng, upazila, image_url, source }], truncated: bool }
//
// নিরাপত্তা/লোড: শুধু পড়া (কোনো লেখা নেই), পাবলিক ডেটা (নাম + কোঅর্ডিনেট — সার্চ API-তে
// আগে থেকেই পাবলিক)। ফেনীর বাইরের বক্স আটকানো, বক্সের আকার ও লিমিট সীমিত, রেসপন্স
// ক্যাশযোগ্য (ক্লায়েন্ট বক্স ~১ কিমি গ্রিডে গোল করে পাঠালে ক্যাশ ভালো কাজ করে)।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// ফেনী জেলার চারপাশে একটু মার্জিনসহ সীমা — এর বাইরে কিছু খুঁজবে না
const LIMITS = { south: 22.65, west: 91.0, north: 23.35, east: 91.65 };
const MAX_SPAN_DEG = 0.12; // বক্সের সর্বোচ্চ দৈর্ঘ্য/প্রস্থ (~১৩ কিমি) — জুম ১৫-এ ফোনের স্ক্রিন এর চেয়ে ছোট
const DEFAULT_LIMIT = 150;
const MAX_LIMIT = 300;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

function num(url, key) {
  const raw = url.searchParams.get(key);
  if (raw === null || raw.trim() === '') return NaN;
  return Number(raw);
}

export async function GET({ url }) {
  try {
    let south = num(url, 'south');
    let west = num(url, 'west');
    let north = num(url, 'north');
    let east = num(url, 'east');

    if ([south, west, north, east].some((v) => !Number.isFinite(v))) {
      return json({ error: 'south, west, north, east সংখ্যা দিতে হবে' }, 400);
    }
    if (south >= north || west >= east) {
      return json({ error: 'বক্সের সীমা ঠিক নেই' }, 400);
    }

    // ফেনীর সীমার ভেতরে আটকানো
    south = Math.max(south, LIMITS.south);
    west = Math.max(west, LIMITS.west);
    north = Math.min(north, LIMITS.north);
    east = Math.min(east, LIMITS.east);
    if (south >= north || west >= east) {
      return json({ results: [], truncated: false });
    }

    // খুব বড় বক্স হলে আটকানো (জুম আউট করে সব লোড করা ঠেকাতে)
    if (north - south > MAX_SPAN_DEG || east - west > MAX_SPAN_DEG) {
      return json({ error: 'এলাকা অনেক বড় — আরও জুম করুন' }, 400);
    }

    let limit = parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT), 10);
    if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
    limit = Math.min(limit, MAX_LIMIT);

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabaseAdmin
      .from('location_suggestions')
      .select('id, name, lat, lng, upazila, image_url, source')
      .gte('lat', south)
      .lte('lat', north)
      .gte('lng', west)
      .lte('lng', east)
      .order('name', { ascending: true })
      .limit(limit);

    if (error) {
      return json({ error: 'ডাটা আনতে সমস্যা হয়েছে' }, 500);
    }

    const results = data || [];
    return json(
      { results, truncated: results.length >= limit },
      200,
      // নাম/কোঅর্ডিনেট ঘনঘন বদলায় না — ব্রাউজারে ১ মিনিট, Vercel edge-এ ৫ মিনিট ক্যাশ
      { 'Cache-Control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' }
    );
  } catch (err) {
    return json({ error: 'অপ্রত্যাশিত ত্রুটি' }, 500);
  }
}