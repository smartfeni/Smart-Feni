// path: src/pages/api/delivery/upload-payment-proof.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_proof_request_lookup, delivery_proof_insert, delivery_proof_unexpected।
// ৪০০/৪০১/৪০৪ রিপোর্ট হয় না। রেসপন্স ও লজিক অপরিবর্তিত।
//
// ============================================================
// API এন্ডপয়েন্ট: পেমেন্ট প্রুফ ইমেজ সেভ (/api/delivery/upload-payment-proof)
// ছবি আগেই ক্লায়েন্ট থেকে Supabase Storage এর "delivery-proofs" bucket এ
// আপলোড হয়ে থাকবে, এখানে শুধু সেই URL গুলোর array সেভ হয়।
// কাস্টমার (বা রাইডার) যেকোনো সময় আপলোড করতে পারবে — একই request_id তে
// একাধিকবার কল হলে নতুন row হিসেবে যোগ হবে (একাধিক প্রুফ থাকতে পারে)।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/upload-payment-proof';

export async function POST({ request }) {
  // এরর রিপোর্টের ক্লায়েন্ট: লগইনের পর ইউজারের নিজের client (যাতে এরর লগে ইউজার আইডি যায়)
  let reportClient = null;

  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    reportClient = client;

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

    if (reqError) {
      // শুধু DB এরর রিপোর্ট; "সম্পর্ক নেই/পাওয়া যায়নি" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_proof_request_lookup',
        title: 'পেমেন্ট প্রুফ: রিকোয়েস্ট পড়া ব্যর্থ',
        message: reqError.message,
        code: reqError.code,
        status: 404,
      });
    }

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
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_proof_insert',
        title: 'পেমেন্ট প্রুফ সেভ ব্যর্থ',
        message: insertError.message,
        code: insertError.code,
        status: 500,
      });
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
    // লগইনের আগেই ক্র্যাশ করলে reportClient নেই — তখন service role client
    let fallbackClient = reportClient;
    if (!fallbackClient) {
      try {
        fallbackClient = getAdminClient().client || null;
      } catch (_) {
        fallbackClient = null;
      }
    }
    await reportServerError(fallbackClient, {
      route: ROUTE,
      action: 'delivery_proof_unexpected',
      title: 'পেমেন্ট প্রুফ: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
