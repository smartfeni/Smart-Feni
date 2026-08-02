// ============================================================
// API এন্ডপয়েন্ট: রাইডার একটা ওপেন রিকোয়েস্টে সাড়া দিবে (/api/delivery/rider-respond)
// দুইটা action সাপোর্ট করে:
//   - "counter": রাইডার নিজের থ্রেডে নতুন দাম প্রস্তাব করবে (শুধু নিজের থ্রেডে দেখা যাবে)
//   - "accept": রাইডার কারেন্ট দামে রাজি, সাথে সাথে ডিল কনফার্ম হয়ে যাবে,
//               বাকি সব থ্রেড auto-close হয়ে যাবে
//
// "counter" অ্যাকশন ইউজারের নিজের টোকেন দিয়ে হয় (RLS respect করে, নিজের থ্রেডেই সীমাবদ্ধ)।
// "accept" অ্যাকশনে একাধিক টেবিলে (own offer + other riders' offers + delivery_requests)
// ক্রস-পার্টি আপডেট লাগে যেটা RLS এ রাইডারের নিজের এক্সেসের বাইরে — তাই এখানে
// আগে ইউজার-টোকেন দিয়ে সব validation (রাইডার approved/active কিনা, রিকোয়েস্ট open কিনা)
// করে নেওয়ার পর, সেই validated ডেটা দিয়েই service role client ব্যবহার করা হয়েছে
// শুধু এই নির্দিষ্ট ট্রানজেকশনটার জন্য।
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

    const { requestId, action, offerPrice } = await request.json();

    if (!requestId || !['accept', 'counter'].includes(action)) {
      return new Response(
        JSON.stringify({ error: 'requestId ও সঠিক action (accept/counter) দিতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রাইডার প্রোফাইল ভেরিফাই — approved ও active হতে হবে
    const { data: rider, error: riderError } = await client
      .from('delivery_riders')
      .select('id, verification_status, is_active')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (riderError || !rider || rider.verification_status !== 'approved' || !rider.is_active) {
      return new Response(
        JSON.stringify({ error: 'তুমি এখনো ভেরিফাইড/একটিভ ডেলিভারি হিরো না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্ট এখনো open কিনা চেক
    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, current_price')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !deliveryRequest) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.status !== 'open') {
      return new Response(
        JSON.stringify({ error: 'এই রিকোয়েস্ট আর ওপেন নেই, অন্য কেউ ডিল কনফার্ম করে ফেলেছে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ============ COUNTER: নিজের থ্রেডে দাম প্রস্তাব ============
    if (action === 'counter') {
      const price = Number(offerPrice);
      if (!Number.isFinite(price) || price <= 0) {
        return new Response(
          JSON.stringify({ error: 'সঠিক দাম দাও' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }

      const { data: offer, error: offerError } = await client
        .from('delivery_offers')
        .upsert(
          {
            request_id: requestId,
            rider_profile_id: user.id,
            rider_id: rider.id,
            offer_price: price,
            last_actor: 'rider',
            status: 'negotiating',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'request_id,rider_profile_id' }
        )
        .select()
        .single();

      if (offerError) {
        return new Response(
          JSON.stringify({ error: 'অফার পাঠানো ব্যর্থ: ' + offerError.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, offer }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ============ ACCEPT: কারেন্ট দামে ডিল কনফার্ম ============
    const { client: adminClient, error: adminError } = getAdminClient();
    if (adminError) {
      return new Response(JSON.stringify({ error: adminError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const finalPrice = deliveryRequest.current_price;

    // নিজের থ্রেড accepted করে (না থাকলে তৈরি করে)
    const { error: acceptOfferError } = await adminClient
      .from('delivery_offers')
      .upsert(
        {
          request_id: requestId,
          rider_profile_id: user.id,
          rider_id: rider.id,
          offer_price: finalPrice,
          last_actor: 'rider',
          status: 'accepted',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'request_id,rider_profile_id' }
      );

    if (acceptOfferError) {
      return new Response(
        JSON.stringify({ error: 'অফার accept ব্যর্থ: ' + acceptOfferError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্ট confirmed করে
    const { data: confirmedRequest, error: confirmError } = await adminClient
      .from('delivery_requests')
      .update({
        status: 'confirmed',
        accepted_rider_id: rider.id,
        final_price: finalPrice,
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .eq('status', 'open') // রেস কন্ডিশন থেকে বাঁচার জন্য — এখনো open থাকলেই আপডেট হবে
      .select()
      .single();

    if (confirmError || !confirmedRequest) {
      return new Response(
        JSON.stringify({ error: 'ডিল কনফার্ম ব্যর্থ, হতে পারে অন্য কেউ আগেই accept করে ফেলেছে' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // বাকি সব থ্রেড বন্ধ করে দেয়
    await adminClient
      .from('delivery_offers')
      .update({ status: 'closed_by_other', updated_at: new Date().toISOString() })
      .eq('request_id', requestId)
      .neq('rider_profile_id', user.id);

    // TODO: বাকি রাইডারদের নোটিফিকেশন — "এই অর্ডার [রাইডারের নাম] একসেপ্ট করেছে, ডিল ক্লোজড"

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