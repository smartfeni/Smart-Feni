// ============================================================
// API এন্ডপয়েন্ট: "ডেলিভারি হিরো হতে চাই" আবেদন (/api/delivery/rider-register)
// লগইন করা ইউজার কল করবে। ছবি ও আইডি কার্ডের ছবি আগেই ক্লায়েন্ট থেকে
// Supabase Storage এর "rider-verification" bucket এ আপলোড হয়ে থাকবে
// (path pattern: {user_id}/photo.jpg, {user_id}/id-card.jpg — RLS policy
// অনুযায়ী এই ফোল্ডার নেমিং জরুরি), এখানে শুধু সেই URL গুলো সেভ হয়।
// verification_status ডিফল্ট 'pending', is_active ডিফল্ট false —
// এডমিন approve না করা পর্যন্ত রাইডার অফার সিস্টেমে ঢুকতে পারবে না।
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';

export const prerender = false;

const VALID_VEHICLE_TYPES = ['bike', 'cycle', 'cng'];

export async function POST({ request }) {
  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { vehicleType, offersDelivery, offersRide, photoUrl, idCardPhotoUrl } = await request.json();

    if (!vehicleType || !VALID_VEHICLE_TYPES.includes(vehicleType)) {
      return new Response(
        JSON.stringify({ error: 'গাড়ির ধরন সিলেক্ট করো (বাইক/সাইকেল/সিএনজি)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalOffersDelivery = Boolean(offersDelivery);
    const finalOffersRide = Boolean(offersRide);

    if (!finalOffersDelivery && !finalOffersRide) {
      return new Response(
        JSON.stringify({ error: 'অন্তত একটা সার্ভিস (ডেলিভারি বা রাইড) সিলেক্ট করতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (finalOffersRide && vehicleType === 'cycle') {
      return new Response(
        JSON.stringify({ error: 'সাইকেল দিয়ে রাইড হিরো হওয়া যায় না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!photoUrl || !idCardPhotoUrl) {
      return new Response(
        JSON.stringify({ error: 'নিজের ছবি ও আইডি কার্ডের ছবি দুটোই আপলোড করতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // আগে থেকে আবেদন করে থাকলে (pending বা approved) আবার আবেদন করতে দিব না
    const { data: existing } = await client
      .from('delivery_riders')
      .select('id, verification_status')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (existing) {
      const message =
        existing.verification_status === 'approved'
          ? 'তুমি ইতিমধ্যে ভেরিফাইড ডেলিভারি হিরো'
          : existing.verification_status === 'pending'
          ? 'তোমার আবেদন আগে থেকেই পর্যালোচনাধীন আছে'
          : 'তোমার আবেদন আগে বাতিল হয়েছিল, আবার আবেদন করতে সাপোর্টে যোগাযোগ করো';
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data, error: insertError } = await client
      .from('delivery_riders')
      .insert({
        profile_id: user.id,
        vehicle_type: vehicleType,
        offers_delivery: finalOffersDelivery,
        offers_ride: finalOffersRide,
        photo_url: photoUrl,
        id_card_photo_url: idCardPhotoUrl,
        verification_status: 'pending',
        is_active: false,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'আবেদন ব্যর্থ: ' + insertError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, rider: data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}