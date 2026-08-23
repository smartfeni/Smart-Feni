// ============================================================
// API এন্ডপয়েন্ট: হিরো বর্তমান সেরা মূল্যে সরাসরি Accept করবে
// (/api/delivery/accept-best-price) — ফার্স্ট-ক্লিক-উইন্স, অ্যাটমিক
// (Postgres RPC accept_service_request দিয়ে, race-condition প্রুফ)
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

    const { requestId } = await request.json();

    if (!requestId) {
      return new Response(
        JSON.stringify({ error: 'requestId আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
        JSON.stringify({ error: 'দুঃখিত, অন্য কেউ আগে নিয়ে নিয়েছে' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const categoryAllowed = reqRow.category === 'ride' ? heroRow.offers_ride : heroRow.offers_delivery;
    if (!categoryAllowed) {
      return new Response(
        JSON.stringify({ error: 'এই ক্যাটাগরিতে তুমি নিবন্ধিত না' }),
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

    const { data: accepted, error: rpcError } = await client.rpc('accept_service_request', {
      p_request_id: requestId,
      p_hero_profile_id: user.id,
      p_hero_id: heroRow.id,
      p_price: currentBest,
    });

    if (rpcError) {
      return new Response(
        JSON.stringify({ error: 'গ্রহণ ব্যর্থ: ' + rpcError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!accepted) {
      return new Response(
        JSON.stringify({ error: 'দুঃখিত, অন্য কেউ আগে নিয়ে নিয়েছে' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, price: currentBest }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
