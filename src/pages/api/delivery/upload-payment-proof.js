// ============================================================
// API এন্ডপয়েন্ট: পেমেন্ট প্রুফ ইমেজ সেভ (/api/delivery/upload-payment-proof)
// ছবি আগেই ক্লায়েন্ট থেকে Supabase Storage এর "delivery-proofs" bucket এ
// আপলোড হয়ে থাকবে, এখানে শুধু সেই URL গুলোর array সেভ হয়।
// কাস্টমার (বা রাইডার) যেকোনো সময় আপলোড করতে পারবে — একই request_id তে
// একাধিকবার কল হলে নতুন row হিসেবে যোগ হবে (একাধিক প্রুফ থাকতে পারে)।
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

    const { requestId, imageUrls } = await request.json();

    if (!requestId || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      return new Response(
        JSON.stringify({ error: 'requestId ও কমপক্ষে একটা ছবির URL আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্টের সাথে সম্পর্ক আছে কিনা (কাস্টমার নিজের রিকোয়েস্ট, বা accepted রাইডার) — RLS এর
    // "Involved parties can view payment proofs" পলিসির লজিকের সাথে সামঞ্জস্যপূর্ণ চেক
    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, customer_profile_id, accepted_rider_id')
      .eq('id', requestId)
      .maybeSingle();

    let isRider = false;
    if (!deliveryRequest || deliveryRequest.customer_profile_id !== user.id) {
      const { data: rider } = await client
        .from('delivery_riders')
        .select('id')
        .eq('profile_id', user.id)
        .maybeSingle();
      isRider = deliveryRequest && rider && rider.id === deliveryRequest.accepted_rider_id;
    }

    if (reqError || !deliveryRequest || (deliveryRequest.customer_profile_id !== user.id && !isRider)) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি বা এই ডেলিভারির সাথে তোমার সম্পর্ক নেই' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data, error: insertError } = await client
      .from('delivery_payment_proofs')
      .insert({
        request_id: requestId,
        image_urls: imageUrls,
        uploaded_by: user.id,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: 'পেমেন্ট প্রুফ সেভ ব্যর্থ: ' + insertError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, proof: data }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}