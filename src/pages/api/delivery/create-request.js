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
import { sendTelegramBroadcast } from '../../../lib/telegramNotify.js';

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

    // ===== কুলডাউন চেক: বারবার ক্যান্সেল করা কাস্টমার =====
    // গত ৭ দিনে ৩ বা তার বেশি রিকোয়েস্ট বাতিল করলে, শেষ বাতিলের
    // ২৪ ঘণ্টা পর্যন্ত নতুন রিকোয়েস্ট করা যাবে না
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { count: cancelCount } = await client
      .from('delivery_requests')
      .select('id', { count: 'exact', head: true })
      .eq('customer_profile_id', user.id)
      .eq('status', 'cancelled')
      .gte('updated_at', sevenDaysAgo);

    if ((cancelCount || 0) >= 3) {
      const { data: lastCancelled } = await client
        .from('delivery_requests')
        .select('updated_at')
        .eq('customer_profile_id', user.id)
        .eq('status', 'cancelled')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (lastCancelled) {
        const cooldownUntil = new Date(lastCancelled.updated_at).getTime() + 24 * 60 * 60 * 1000;
        if (Date.now() < cooldownUntil) {
          const hoursLeft = Math.ceil((cooldownUntil - Date.now()) / (60 * 60 * 1000));
          return new Response(
            JSON.stringify({
              error: `বারবার রিকোয়েস্ট বাতিল করার কারণে সাময়িকভাবে নতুন রিকোয়েস্ট করা বন্ধ আছে — আর ${hoursLeft} ঘণ্টা পর আবার চেষ্টা করো`,
            }),
            { status: 429, headers: { 'Content-Type': 'application/json' } }
          );
        }
      }
    }

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

    // ম্যাচিং হিরোদের (category + upazila + vehicle অনুযায়ী) Telegram
    // নোটিফিকেশন — যাদের telegram_chat_id লিংক করা আছে তাদেরই যাবে,
    // অনলাইন/অফলাইন টগল নির্বিশেষে (আগের সিদ্ধান্ত অনুযায়ী)
    let heroQuery = client
      .from('delivery_riders')
      .select('profiles!delivery_riders_profile_id_fkey(telegram_chat_id)')
      .eq('verification_status', 'approved')
      .eq(finalCategory === 'ride' ? 'offers_ride' : 'offers_delivery', true)
      .eq('upazila', upazila);

    if (finalVehicleType !== 'any') {
      heroQuery = heroQuery.eq('vehicle_type', finalVehicleType);
    }

    const { data: matchingHeroes } = await heroQuery;
    const chatIds = (matchingHeroes || [])
      .map((h) => h.profiles?.telegram_chat_id)
      .filter(Boolean);

    const categoryLabel = finalCategory === 'ride' ? 'রাইড' : 'ডেলিভারি';
    await sendTelegramBroadcast(
      chatIds,
      `🔔 নতুন ${categoryLabel} রিকোয়েস্ট!\n📍 ${upazila}\n💰 প্রস্তাবিত মূল্য: ৳${price}\n\nঅ্যাপে গিয়ে অফার দিন।`
    );

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