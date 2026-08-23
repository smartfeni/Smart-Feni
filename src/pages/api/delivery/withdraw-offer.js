// ============================================================
// API এন্ডপয়েন্ট: হিরো নিজের সক্রিয় অফার তুলে নিবে
// (/api/delivery/withdraw-offer)
// শুধু status='active' এবং created_at ১ মিনিটের মধ্যে হলেই
// withdraw করা যাবে (ভুল এন্ট্রি সাথে সাথে ঠিক করার জন্য) —
// ১ মিনিট পার হয়ে গেলে আর withdraw করা যাবে না।
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';

export const prerender = false;

const WITHDRAW_WINDOW_MS = 60 * 1000;

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

    const { data: offer, error: offerFetchError } = await client
      .from('delivery_offers')
      .select('id, status, rider_profile_id, created_at')
      .eq('request_id', requestId)
      .eq('rider_profile_id', user.id)
      .maybeSingle();

    if (offerFetchError || !offer) {
      return new Response(
        JSON.stringify({ error: 'তোমার কোনো অফার পাওয়া যায়নি এই রিকোয়েস্টে' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (offer.status !== 'active') {
      return new Response(
        JSON.stringify({ error: 'এই অফার আর withdraw করা যাবে না (হয়তো ইতিমধ্যে accept/close হয়ে গেছে)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const ageMs = Date.now() - new Date(offer.created_at).getTime();
    if (ageMs > WITHDRAW_WINDOW_MS) {
      return new Response(
        JSON.stringify({ error: 'অফার দেওয়ার ১ মিনিট পার হয়ে গেছে, আর withdraw করা যাবে না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: updated, error: updateError } = await client
      .from('delivery_offers')
      .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
      .eq('id', offer.id)
      .eq('status', 'active')
      .select()
      .single();

    if (updateError || !updated) {
      return new Response(
        JSON.stringify({ error: 'অফার withdraw ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, offer: updated }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}