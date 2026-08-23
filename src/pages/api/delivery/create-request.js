// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার নতুন ডেলিভারি রিকোয়েস্ট তৈরি করবে (/api/delivery/create-request)
// লগইন করা কাস্টমার কল করবে (Authorization: Bearer <token> হেডার সহ)।
// ইউজারের নিজের সেশন টোকেন দিয়ে insert হয় (RLS respect করে)।
//
// আপডেট (এই সেশন): expires_at = তৈরির সময় + ১ ঘণ্টা সেট হয় —
// এই সময়ের মধ্যে কোনো রাইডার accept না করলে রিকোয়েস্ট auto-expire
// হয়ে যাবে (expire-requests.js এই কলামটা চেক করে)। accept হয়ে
// গেলে (status='confirmed') এই expiry আর প্রযোজ্য না।
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';

export const prerender = false;

const VALID_VEHICLE_TYPES = ['bike', 'cycle', 'cng', 'any'];
const VALID_CATEGORIES = ['delivery', 'ride'];
const EXPIRY_HOURS = 1;

export async function POST({ request }) {
  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const {
      category,
      upazila,
      pickupAddress,
      pickupLat,
      pickupLng,
      pickupInstructions,
      dropAddress,
      dropLat,
      dropLng,
      dropInstructions,
      description,
      vehicleType,
      seatCount,
      askingPrice,
    } = await request.json();

    const finalCategory = VALID_CATEGORIES.includes(category) ? category : 'delivery';

    if (!upazila || !pickupAddress || !dropAddress || !description || !askingPrice) {
      return new Response(
        JSON.stringify({ error: 'উপজেলা, পিকআপ/ড্রপ ঠিকানা, বিবরণ ও দাম আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const price = Number(askingPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return new Response(
        JSON.stringify({ error: 'সঠিক দাম দাও (০ এর বেশি সংখ্যা)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalVehicleType = VALID_VEHICLE_TYPES.includes(vehicleType) ? vehicleType : 'any';

    if (finalCategory === 'ride' && finalVehicleType === 'cycle') {
      return new Response(
        JSON.stringify({ error: 'রাইড রিকোয়েস্টে সাইকেল সিলেক্ট করা যাবে না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const expiresAt = new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000).toISOString();

    const { data, error: insertError } = await client
      .from('delivery_requests')
      .insert({
        customer_profile_id: user.id,
        category: finalCategory,
        upazila,
        // পুরনো কলাম — ব্যাকওয়ার্ড কম্প্যাটিবিলিটি (এখনো রিডিজাইন না হওয়া UI এর জন্য)
        area_detail: dropAddress,
        pickup_address: pickupAddress,
        pickup_lat: pickupLat || null,
        pickup_lng: pickupLng || null,
        pickup_instructions: pickupInstructions || null,
        drop_address: dropAddress,
        drop_lat: dropLat || null,
        drop_lng: dropLng || null,
        drop_instructions: dropInstructions || null,
        description,
        vehicle_type: finalVehicleType,
        seat_count: finalCategory === 'ride' ? seatCount || null : null,
        // পুরনো ও নতুন — দুই মডেলের জন্যই দাম পূরণ থাকবে
        initial_price: price,
        current_price: price,
        customer_asking_price: price,
        status: 'open',
        expires_at: expiresAt,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট তৈরি ব্যর্থ: ' + insertError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // TODO: এখানে Telegram bot এর ১ম নোটিফিকেশন ট্রিগার হবে

    return new Response(
      JSON.stringify({ success: true, request: data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}