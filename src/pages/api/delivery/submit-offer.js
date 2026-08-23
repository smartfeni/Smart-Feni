// ============================================================
// API এন্ডপয়েন্ট: হিরো নতুন প্রতিযোগিতামূলক অফার দিবে
// (/api/delivery/submit-offer) — Smart Hero / Ride Hero "সেরা মূল্য" মডেল
//
// শর্ত: নতুন অফার অবশ্যই বর্তমান সেরা মূল্যের চেয়ে কমপক্ষে ৳১ কম হতে হবে।
// একই হিরো একই রিকোয়েস্টে আগে অফার দিয়ে থাকলে upsert (নতুন রো না বানিয়ে
// পুরনোটাই আপডেট হয়, created_at রিসেট হয় — withdraw উইন্ডো নতুন করে শুরু)।
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { requestId, offerPrice } = await request.json();

    if (!requestId || !offerPrice) {
      return new Response(
        JSON.stringify({ error: 'requestId ও offerPrice আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const price = Number(offerPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return new Response(
        JSON.stringify({ error: 'সঠিক দাম দাও' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // নিজের হিরো প্রোফাইল যাচাই
    const { data: heroRow, error: heroError } = await client
      .from('delivery_riders')
      .select('id, vehicle_type, offers_delivery, offers_ride, verification_status')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (heroError || !heroRow || heroRow.verification_status !== 'approved') {
      return new Response(
        JSON.stringify({ error: 'তুমি এখনো ভেরিফাইড হিরো না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্ট যাচাই
    const { data: reqRow, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, category, customer_asking_price, vehicle_type')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !reqRow) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.status !== 'open') {
      return new Response(
        JSON.stringify({ error: 'এই রিকোয়েস্ট আর খোলা নাই' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const categoryAllowed = reqRow.category === 'ride' ? heroRow.offers_ride : heroRow.offers_delivery;
    if (!categoryAllowed) {
      return new Response(
        JSON.stringify({ error: 'এই ক্যাটাগরিতে তুমি নিবন্ধিত না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.vehicle_type !== 'any' && reqRow.vehicle_type !== heroRow.vehicle_type) {
      return new Response(
        JSON.stringify({ error: 'তোমার বাহনের ধরন এই রিকোয়েস্টের সাথে মিলছে না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // বর্তমান সেরা মূল্য বের করা
    const { data: activeOffers } = await client
      .from('delivery_offers')
      .select('offer_price')
      .eq('request_id', requestId)
      .eq('status', 'active');

    const lowestOffer = (activeOffers || []).reduce(
      (min, o) => (o.offer_price < min ? o.offer_price : min),
      Infinity
    );
    const currentBest = Math.min(Number(reqRow.customer_asking_price), lowestOffer);

    if (price > currentBest - 1) {
      return new Response(
        JSON.stringify({ error: `বর্তমান সেরা মূল্যের (৳${currentBest}) চেয়ে কমপক্ষে ৳১ কম দিতে হবে` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: upserted, error: upsertError } = await client
      .from('delivery_offers')
      .upsert(
        {
          request_id: requestId,
          rider_id: heroRow.id,
          rider_profile_id: user.id,
          offer_price: price,
          status: 'active',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'request_id,rider_profile_id' }
      )
      .select()
      .single();

    if (upsertError || !upserted) {
      return new Response(
        JSON.stringify({ error: 'অফার দেওয়া ব্যর্থ: ' + (upsertError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, offer: upserted }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}