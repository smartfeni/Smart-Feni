// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার নতুন ডেলিভারি রিকোয়েস্ট তৈরি করবে (/api/delivery/create-request)
// লগইন করা কাস্টমার কল করবে (Authorization: Bearer <token> হেডার সহ)।
// ইউজারের নিজের সেশন টোকেন দিয়ে insert হয় (RLS respect করে) —
// delivery_requests এর "Customers can create requests" পলিসি অনুযায়ী
// শুধু নিজের customer_profile_id দিয়েই রিকোয়েস্ট বানাতে পারবে।
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';

export const prerender = false;

const VALID_VEHICLE_TYPES = ['bike', 'cycle', 'any'];

export async function POST({ request }) {
  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { upazila, areaDetail, description, vehicleType, initialPrice } = await request.json();

    if (!upazila || !areaDetail || !description || !initialPrice) {
      return new Response(
        JSON.stringify({ error: 'লোকেশন, ডিটেইল, এলাকার বিবরণ ও দাম আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const price = Number(initialPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return new Response(
        JSON.stringify({ error: 'সঠিক দাম দাও (০ এর বেশি সংখ্যা)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalVehicleType = VALID_VEHICLE_TYPES.includes(vehicleType) ? vehicleType : 'any';

    const { data, error: insertError } = await client
      .from('delivery_requests')
      .insert({
        customer_profile_id: user.id,
        upazila,
        area_detail: areaDetail,
        description,
        vehicle_type: finalVehicleType,
        initial_price: price,
        current_price: price,
        status: 'open',
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
    // (সব active রেজিস্টার্ড রাইডারকে "নতুন অর্ডার এসেছে" এলার্ট) — পরে যোগ হবে

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