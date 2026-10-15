// path: src/pages/api/delivery/mark-pickup-done.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_pickup_rider_lookup, delivery_pickup_request_lookup, delivery_pickup_admin_config,
// delivery_pickup_update, delivery_pickup_unexpected।
// ৪০০/৪০১/৪০৩/৪০৪ এবং রেস কন্ডিশন (PGRST116, দুইবার ক্লিক) রিপোর্ট হয় না।
// রেসপন্স ও লজিক অপরিবর্তিত।
//
// ============================================================
// API এন্ডপয়েন্ট: রাইড হিরো পিকআপ সম্পন্ন মার্ক করবে
// (/api/delivery/mark-pickup-done)
// status='confirmed' অবস্থায়, pickup_done_at সেট করে দেয় —
// তখন থেকে হিরোর কার্ডে ড্রপ-অফ লোকেশন/দূরত্ব দেখানো শুরু হবে।
// confirm-delivery.js এর প্যাটার্ন অনুসরণ করে: রাইডারের RLS scope এ
// delivery_requests আপডেট করার পারমিশন নেই, তাই আগে user token দিয়ে
// validation করে, তারপর service role client দিয়ে আপডেট করা হয়েছে।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendNotification } from '../../../lib/notify.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/mark-pickup-done';

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

    const { requestId } = await request.json();

    if (!requestId) {
      return new Response(
        JSON.stringify({ error: 'requestId আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: rider, error: riderError } = await client
      .from('delivery_riders')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (riderError) {
      // শুধু DB এরর রিপোর্ট; "প্রোফাইল নেই" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_pickup_rider_lookup',
        title: 'পিকআপ মার্ক: হিরো প্রোফাইল পড়া ব্যর্থ',
        message: riderError.message,
        code: riderError.code,
        status: 403,
      });
    }

    if (riderError || !rider) {
      return new Response(
        JSON.stringify({ error: 'তোমার হিরো প্রোফাইল পাওয়া যায়নি' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: reqRow, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, accepted_rider_id, pickup_done_at')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      // শুধু DB এরর রিপোর্ট; "পাওয়া যায়নি" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_pickup_request_lookup',
        title: 'পিকআপ মার্ক: রিকোয়েস্ট পড়া ব্যর্থ',
        message: reqError.message,
        code: reqError.code,
        status: 404,
      });
    }

    if (reqError || !reqRow) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.accepted_rider_id !== rider.id) {
      return new Response(
        JSON.stringify({ error: 'এটা তোমার রাইড না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.status !== 'confirmed') {
      return new Response(
        JSON.stringify({ error: 'এই রাইড এখন এই ধাপে নাই' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.pickup_done_at) {
      return new Response(
        JSON.stringify({ error: 'পিকআপ ইতিমধ্যে সম্পন্ন হিসেবে মার্ক করা আছে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { client: adminClient, error: adminError } = getAdminClient();
    if (adminError) {
      // সার্ভিস-কী কনফিগ সমস্যা — ইউজারের client দিয়ে রিপোর্ট
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_pickup_admin_config',
        title: 'পিকআপ মার্ক: সার্ভার কনফিগ সমস্যা (service role)',
        message: adminError,
        status: 500,
      });
      return new Response(JSON.stringify({ error: adminError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: updated, error: updateError } = await adminClient
      .from('delivery_requests')
      .update({ pickup_done_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'confirmed')
      .is('pickup_done_at', null)
      .select()
      .single();

    if (updateError || !updated) {
      // PGRST116 = কোনো রো মেলেনি (দুইবার ক্লিক/রেস) — রিপোর্ট নয়
      if (updateError && updateError.code !== 'PGRST116') {
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_pickup_update',
          title: 'পিকআপ মার্ক করা ব্যর্থ',
          message: updateError.message,
          code: updateError.code,
          status: 500,
        });
      }
      return new Response(
        JSON.stringify({ error: 'পিকআপ মার্ক করা ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // কাস্টমারকে জানানো — best-effort, ব্যর্থ হলেও পিকআপ মার্ক হয়ে গেছে
    // এই রেসপন্সে কোনো প্রভাব পড়বে না। updated রো-তেই customer_profile_id
    // ও category আগে থেকে আছে (update().select() সব কলাম রিটার্ন করে)
    const isRide = updated.category === 'ride';
    await sendNotification(adminClient, {
      userId: updated.customer_profile_id,
      message: isRide ? 'হিরো পিকআপ সম্পন্ন করেছেন, আপনাকে নিয়ে গন্তব্যের পথে রওনা দিয়েছেন' : 'হিরো পিকআপ সম্পন্ন করেছেন, আপনার ডেলিভারি নিয়ে পথে আছেন',
      category: 'delivery_hero',
      actionUrl: '/my-orders',
      relatedEntityType: 'delivery_request',
      relatedEntityId: requestId,
      senderType: 'rider',
      senderId: user.id,
    });

    return new Response(
      JSON.stringify({ success: true, request: updated }),
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
      action: 'delivery_pickup_unexpected',
      title: 'পিকআপ মার্ক: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
