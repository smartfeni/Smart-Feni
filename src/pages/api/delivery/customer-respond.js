// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার কোনো রাইডারের অফারে সাড়া দিবে (/api/delivery/customer-respond)
// দুইটা action:
//   - "counter": নির্দিষ্ট রাইডারের থ্রেডে নতুন দাম প্রস্তাব করবে, এবং এই নতুন দাম
//                delivery_requests.current_price ও আপডেট হবে (যারা এখনো অফার করেনি
//                তারা এই নতুন দামই দেখবে — যেমনটা প্ল্যানে ঠিক হয়েছিল)
//   - "accept": এই নির্দিষ্ট রাইডারের থ্রেডের দামে ডিল কনফার্ম, বাকি সব থ্রেড বন্ধ
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';

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

    const { requestId, riderProfileId, action, offerPrice } = await request.json();

    if (!requestId || !riderProfileId || !['accept', 'counter'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'requestId, riderProfileId ও সঠিক action (accept/counter) দিতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্ট নিজের কিনা এবং এখনো open কিনা যাচাই — normal client দিয়ে (RLS নিজেই আটকাবে অন্যের রিকোয়েস্ট হলে)
    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, customer_profile_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !deliveryRequest) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি বা এটা তোমার নিজের রিকোয়েস্ট না' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.status !== 'open') {
      return new Response(
        JSON.stringify({ error: 'এই রিকোয়েস্ট আর ওপেন নেই' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // সংশ্লিষ্ট থ্রেড খুঁজে বের করা
    const { data: offer, error: offerFetchError } = await client
      .from('delivery_offers')
      .select('id, rider_id, offer_price, status')
      .eq('request_id', requestId)
      .eq('rider_profile_id', riderProfileId)
      .maybeSingle();

    if (offerFetchError || !offer) {
      return new Response(
        JSON.stringify({ error: 'এই রাইডারের থ্রেড পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ============ COUNTER: এই থ্রেডে নতুন দাম, ও গ্লোবাল current_price আপডেট ============
    if (action === 'counter') {
      const price = Number(offerPrice);
      if (!Number.isFinite(price) || price <= 0) {
        return new Response(
          JSON.stringify({ error: 'সঠিক দাম দাও' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: offerUpdateError } = await client
        .from('delivery_offers')
        .update({
          offer_price: price,
          last_actor: 'customer',
          status: 'negotiating',
          updated_at: new Date().toISOString(),
        })
        .eq('id', offer.id);

      if (offerUpdateError) {
        return new Response(
          JSON.stringify({ error: 'কাউন্টার পাঠানো ব্যর্থ: ' + offerUpdateError.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { error: reqUpdateError } = await client
        .from('delivery_requests')
        .update({ current_price: price, updated_at: new Date().toISOString() })
        .eq('id', requestId);

      if (reqUpdateError) {
        return new Response(
          JSON.stringify({ error: 'আস্কিং প্রাইস আপডেট ব্যর্থ: ' + reqUpdateError.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, offerPrice: price }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ============ ACCEPT: এই থ্রেডের দামে ডিল কনফার্ম ============
    const { client: adminClient, error: adminError } = getAdminClient();
    if (adminError) {
      return new Response(JSON.stringify({ error: adminError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const finalPrice = offer.offer_price;

    const { error: acceptOfferError } = await adminClient
      .from('delivery_offers')
      .update({
        status: 'accepted',
        last_actor: 'customer',
        updated_at: new Date().toISOString(),
      })
      .eq('id', offer.id);

    if (acceptOfferError) {
      return new Response(
        JSON.stringify({ error: 'অফার accept ব্যর্থ: ' + acceptOfferError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: confirmedRequest, error: confirmError } = await adminClient
      .from('delivery_requests')
      .update({
        status: 'confirmed',
        accepted_rider_id: offer.rider_id,
        final_price: finalPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'open')
      .select()
      .single();

    if (confirmError || !confirmedRequest) {
      return new Response(
        JSON.stringify({ error: 'ডিল কনফার্ম ব্যর্থ, হতে পারে এর মধ্যেই কনফার্ম হয়ে গেছে' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // বাকি সব থ্রেড বন্ধ
    await adminClient
      .from('delivery_offers')
      .update({ status: 'closed_by_other', updated_at: new Date().toISOString() })
      .eq('request_id', requestId)
      .neq('id', offer.id);

    // TODO: বাকি রাইডারদের নোটিফিকেশন — "ডিল ক্লোজড"

    return new Response(
      JSON.stringify({ success: true, request: confirmedRequest }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}