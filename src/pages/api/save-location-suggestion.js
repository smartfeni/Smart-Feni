// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার-কনফার্মড লোকেশন সেভ (/api/save-location-suggestion)
//
// কখন কল হয়: Delivery Hero-র পিকআপ LocationPicker-এ কাস্টমার ম্যাপে
// পিন বসিয়ে "সেভ করুন" চাপার সময়, যদি ঐচ্ছিক "জায়গার নাম" ফিল্ডে কিছু
// লেখে (যেমন "নবী হোটেল")। শুধু তখনই এই এন্ডপয়েন্ট কল হয় — খালি
// রাখলে fire হয়ই না (LocationPicker.astro-তেই স্কিপ হয়ে যায়)।
//
// গুরুত্বপূর্ণ: এখানে reverse-geocode করা লম্বা ঠিকানা সেভ হয় না —
// শুধু কাস্টমারের নিজের দেওয়া ছোট নামটাই সেভ হয়, যাতে ভবিষ্যতে
// রিকমেন্ডেশন ড্রপডাউনে ছোট, চেনা নাম দেখায়।
//
// ডুপ্লিকেট ঠেকানো: একই স্থানের ৫০ মিটারের মধ্যে আগে থেকে কোনো
// সাজেশন থাকলে নতুন করে সেভ হয় না (বারবার একই জায়গা যোগ হওয়া আটকাতে)।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

const DUPLICATE_RADIUS_METERS = 50;
const BD_BOUNDS = { minLat: 20.5, maxLat: 26.7, minLng: 88, maxLng: 92.8 };

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const name = (body?.name || '').trim();
    const lat = Number(body?.lat);
    const lng = Number(body?.lng);

    if (!name || name.length < 2 || name.length > 60) {
      return new Response(JSON.stringify({ error: 'নাম ২-৬০ অক্ষরের মধ্যে হতে হবে' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < BD_BOUNDS.minLat ||
      lat > BD_BOUNDS.maxLat ||
      lng < BD_BOUNDS.minLng ||
      lng > BD_BOUNDS.maxLng
    ) {
      return new Response(JSON.stringify({ error: 'অবৈধ লোকেশন' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

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

    // কাছাকাছি (~500 মিটার বক্স) আগে থেকে কোনো সাজেশন আছে কিনা চেক —
    // ছোট রেঞ্জে DB থেকে টেনে এনে নিখুঁত দূরত্ব হিসাব করা হচ্ছে
    const latDelta = 0.005;
    const lngDelta = 0.005;
    const { data: nearby } = await supabaseAdmin
      .from('location_suggestions')
      .select('id, lat, lng')
      .gte('lat', lat - latDelta)
      .lte('lat', lat + latDelta)
      .gte('lng', lng - lngDelta)
      .lte('lng', lng + lngDelta);

    const isDuplicate = (nearby || []).some(
      (row) => haversineMeters(lat, lng, row.lat, row.lng) < DUPLICATE_RADIUS_METERS
    );

    if (isDuplicate) {
      return new Response(JSON.stringify({ success: true, skipped: 'duplicate' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { error: insertError } = await supabaseAdmin.from('location_suggestions').insert({
      name,
      lat,
      lng,
      source: 'user_confirmed',
    });

    if (insertError) {
      return new Response(JSON.stringify({ error: 'সেভ ব্যর্থ: ' + insertError.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
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
