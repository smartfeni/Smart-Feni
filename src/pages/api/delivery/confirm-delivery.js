// path: src/pages/api/delivery/confirm-delivery.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_complete_rider_lookup, delivery_complete_request_lookup, delivery_complete_admin_config,
// delivery_complete_update, delivery_complete_stats, delivery_complete_unexpected।
// ৪০০/৪০১/৪০৩/৪০৪ এবং রেস কন্ডিশন (PGRST116, দুইবার ক্লিক) রিপোর্ট হয় না।
// রেসপন্স ও লজিক অপরিবর্তিত (stats ফেইলে আগের মতোই ইউজারকে এরর দেখানো হয় না, শুধু এখন রিপোর্ট হয়)।
//
// আপডেট (N19): sendNotification এ priority: 'high' যোগ — ডেলিভারি সম্পন্ন হওয়ার খবর কাস্টমারের কাছে সাথে সাথে যাওয়া দরকার।
// ============================================================
// API এন্ডপয়েন্ট: রাইডার ডেলিভারি/রাইড সম্পন্ন করবে (/api/delivery/confirm-delivery)
// status: confirmed -> completed  (কাস্টমারের "রিসিভড" ধাপ আর নেই)
//
// আপডেট (নতুন ফ্লো): অর্ডারের পর সব ধাপ রাইডারের — একসেপ্ট, পিকআপ, সম্পন্ন।
// কাস্টমারের শেষ কনফার্ম বাদ; কাস্টমার শুধু সমস্যা হলে ডিসপিউট রিপোর্ট করে
// (raise-dispute.js, সম্পন্ন হওয়ার ১ ঘণ্টা পর্যন্ত)। শর্ত: পিকআপ সম্পন্ন
// (pickup_done_at) না হলে সম্পন্ন করা যায় না। পুরোনো চলমান রিকোয়েস্ট যেগুলো
// ইতিমধ্যে 'delivered' অবস্থায় আছে সেগুলোও আগের মতো সম্পন্ন করা যায়।
// এখানে delivery_riders এর stats (total_completed, total_earned) আপডেট হয়।
// রাইডারের RLS scope এ delivery_requests.status আপডেট করার পারমিশন নেই
// (শুধু কাস্টমার নিজের রিকোয়েস্ট আপডেট করতে পারে), তাই user token দিয়ে
// আগে সব validation করে, তারপর service role client দিয়ে আপডেট করা হয়েছে।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendNotification } from '../../../lib/notify.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/confirm-delivery';

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

    // রাইডার প্রোফাইল বের করা
    const { data: rider, error: riderError } = await client
      .from('delivery_riders')
      .select('id, total_completed, total_earned')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (riderError) {
      // শুধু DB এরর রিপোর্ট; "প্রোফাইল নেই" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_complete_rider_lookup',
        title: 'ডেলিভারি সম্পন্ন: রাইডার প্রোফাইল পড়া ব্যর্থ',
        message: riderError.message,
        code: riderError.code,
        status: 403,
      });
    }

    if (riderError || !rider) {
      return new Response(
        JSON.stringify({ error: 'তোমার রাইডার প্রোফাইল পাওয়া যায়নি' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্টটা এই রাইডারেরই কিনা এবং status delivered কিনা যাচাই
    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, accepted_rider_id, final_price, pickup_done_at')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      // শুধু DB এরর রিপোর্ট; "পাওয়া যায়নি" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_complete_request_lookup',
        title: 'ডেলিভারি সম্পন্ন: রিকোয়েস্ট পড়া ব্যর্থ',
        message: reqError.message,
        code: reqError.code,
        status: 404,
      });
    }

    if (reqError || !deliveryRequest) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.accepted_rider_id !== rider.id) {
      return new Response(
        JSON.stringify({ error: 'এটা তোমার ডেলিভারি না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // নতুন ফ্লো: confirmed থেকে সরাসরি; পুরোনো 'delivered' রিকোয়েস্টও চলবে
    if (deliveryRequest.status !== 'confirmed' && deliveryRequest.status !== 'delivered') {
      return new Response(
        JSON.stringify({ error: 'এই অবস্থায় সম্পন্ন করা যাবে না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.status === 'confirmed' && !deliveryRequest.pickup_done_at) {
      return new Response(
        JSON.stringify({ error: 'আগে পিকআপ সম্পন্ন করুন, তারপর সম্পন্ন করা যাবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { client: adminClient, error: adminError } = getAdminClient();
    if (adminError) {
      // সার্ভিস-কী কনফিগ সমস্যা — ইউজারের client দিয়ে রিপোর্ট
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_complete_admin_config',
        title: 'ডেলিভারি সম্পন্ন: সার্ভার কনফিগ সমস্যা (service role)',
        message: adminError,
        status: 500,
      });
      return new Response(JSON.stringify({ error: adminError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: updatedRequest, error: updateReqError } = await adminClient
      .from('delivery_requests')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .in('status', ['confirmed', 'delivered'])
      .select()
      .single();

    if (updateReqError || !updatedRequest) {
      // PGRST116 = কোনো রো মেলেনি (দুইবার ক্লিক/রেস) — রিপোর্ট নয়
      if (updateReqError && updateReqError.code !== 'PGRST116') {
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_complete_update',
          title: 'ডেলিভারি সম্পন্ন করা ব্যর্থ',
          message: updateReqError.message,
          code: updateReqError.code,
          status: 500,
        });
      }
      return new Response(
        JSON.stringify({ error: 'কনফার্ম ব্যর্থ: ' + (updateReqError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const earnedAmount = Number(deliveryRequest.final_price) || 0;

    const { error: statsError } = await adminClient
      .from('delivery_riders')
      .update({
        total_completed: (rider.total_completed || 0) + 1,
        total_earned: (Number(rider.total_earned) || 0) + earnedAmount,
      })
      .eq('id', rider.id);

    if (statsError) {
      // request completed হয়ে গেছে কিন্তু stats আপডেট ব্যর্থ — এটা লগ করা দরকার,
      // কিন্তু ইউজারকে error দেখাচ্ছি না কারণ মূল কাজ (delivery completed) সফল হয়েছে
      console.error('Rider stats আপডেট ব্যর্থ:', statsError.message);
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_complete_stats',
        title: 'ডেলিভারি সম্পন্ন: রাইডারের stats আপডেট ব্যর্থ',
        message: statsError.message,
        code: statsError.code,
        status: 200,
      });
    }

    // কাস্টমারকে জানানো — সম্পন্ন হয়েছে, রিভিউ দিতে বলা। best-effort,
    // updatedRequest রো-তে customer_profile_id ও category আগে থেকেই আছে
    const isRide = updatedRequest.category === 'ride';
    await sendNotification(adminClient, {
      userId: updatedRequest.customer_profile_id,
      message: isRide
        ? 'আপনার যাত্রা সম্পন্ন হয়েছে! সমস্যা থাকলে ১ ঘণ্টার মধ্যে রিপোর্ট করুন, নইলে হিরোকে রিভিউ দিন'
        : 'আপনার ডেলিভারি সম্পন্ন হয়েছে! সমস্যা থাকলে ১ ঘণ্টার মধ্যে রিপোর্ট করুন, নইলে হিরোকে রিভিউ দিন',
      category: 'delivery_hero',
      actionUrl: '/my-orders',
      priority: 'high',
      relatedEntityType: 'delivery_request',
      relatedEntityId: requestId,
      senderType: 'rider',
      senderId: user.id,
    });

    return new Response(
      JSON.stringify({ success: true, request: updatedRequest }),
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
      action: 'delivery_complete_unexpected',
      title: 'ডেলিভারি সম্পন্ন: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
