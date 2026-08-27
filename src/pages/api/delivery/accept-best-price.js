// ============================================================
// API এন্ডপয়েন্ট: হিরো বর্তমান সেরা মূল্যে সরাসরি Accept করবে
// (/api/delivery/accept-best-price) — ফার্স্ট-ক্লিক-উইন্স, অ্যাটমিক
// (Postgres RPC accept_service_request দিয়ে, race-condition প্রুফ)
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';
import { sendTelegramBroadcast } from '../../../lib/telegramNotify.js';

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

    // এটা কাস্টমারের নিজের asking price-এ সরাসরি রাজি হওয়া — অন্য
    // হিরোরা কত অফার করছে তার সাথে এর কোনো সম্পর্ক নাই, তাই সবসময়
    // customer_asking_price-ই ব্যবহার হবে (MIN() না)
    const finalPrice = Number(reqRow.customer_asking_price);

    const { data: accepted, error: rpcError } = await client.rpc('accept_service_request', {
      p_request_id: requestId,
      p_hero_profile_id: user.id,
      p_hero_id: heroRow.id,
      p_price: finalPrice,
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

    // যেসব হিরো অফার দিয়েছিল কিন্তু এই হিরোর সরাসরি accept-এ হেরে
    // গেছে, তাদের জানানো (নিজেকে বাদ দিয়ে)
    const { data: losingOffers } = await client
      .from('delivery_offers')
      .select('profiles!delivery_offers_rider_profile_id_fkey(telegram_chat_id)')
      .eq('request_id', requestId)
      .eq('status', 'closed_by_other')
      .neq('rider_profile_id', user.id);

    const losingChatIds = (losingOffers || [])
      .map((o) => o.profiles?.telegram_chat_id)
      .filter(Boolean);

    await sendTelegramBroadcast(
      losingChatIds,
      `দুঃখিত, একটা রিকোয়েস্ট আরেকজন হিরো নিয়ে নিয়েছে। পরের বার দ্রুত অফার দিন!`
    );

    return new Response(
      JSON.stringify({ success: true, price: finalPrice }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
