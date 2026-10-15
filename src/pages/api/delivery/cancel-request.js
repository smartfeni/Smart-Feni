// path: src/pages/api/delivery/cancel-request.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_cancel_request_lookup, delivery_cancel_update, delivery_cancel_active_offers,
// delivery_cancel_unexpected। ৪০০/৪০১/৪০৪ এবং রেস কন্ডিশন (PGRST116, দুইবার ক্লিক) রিপোর্ট হয় না।
// রেসপন্স ও লজিক অপরিবর্তিত।
//
// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার নিজের ওপেন রিকোয়েস্ট বাতিল করবে
// (/api/delivery/cancel-request)
// শুধু status='open' (কোনো রাইডার accept করার আগে) অবস্থাতেই
// বাতিল করা যাবে — একবার confirmed হয়ে গেলে এটা দিয়ে বাতিল
// করা যাবে না (ডিসপিউট ফ্লো দিয়ে হ্যান্ডল হবে)।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendBulkNotifications } from '../../../lib/notify.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/cancel-request';

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

    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, customer_profile_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      // শুধু DB এরর রিপোর্ট; "পাওয়া যায়নি" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_cancel_request_lookup',
        title: 'রিকোয়েস্ট বাতিল: রিকোয়েস্ট পড়া ব্যর্থ',
        message: reqError.message,
        code: reqError.code,
        status: 404,
      });
    }

    if (reqError || !deliveryRequest) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি বা এটা তোমার নিজের রিকোয়েস্ট না' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.status !== 'open') {
      return new Response(
        JSON.stringify({ error: 'শুধু ওপেন রিকোয়েস্ট বাতিল করা যাবে, ডিল কনফার্ম হয়ে গেলে বাতিল করা যায় না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: updated, error: updateError } = await client
      .from('delivery_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'open')
      .select()
      .single();

    if (updateError || !updated) {
      // PGRST116 = কোনো রো মেলেনি (চেক ও আপডেটের মাঝে স্ট্যাটাস বদলে গেছে, রেস) — রিপোর্ট নয়
      if (updateError && updateError.code !== 'PGRST116') {
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_cancel_update',
          title: 'রিকোয়েস্ট বাতিল ব্যর্থ',
          message: updateError.message,
          code: updateError.code,
          status: 500,
        });
      }
      return new Response(
        JSON.stringify({ error: 'বাতিল ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // যারা এই রিকোয়েস্টে একটিভ অফার দিয়ে রেখেছিল তাদের জানানো —
    // best-effort, ব্যর্থ হলেও বাতিল সফল হয়েছে এই রেসপন্সে প্রভাব পড়বে না
    const { data: activeOffers, error: activeOffersError } = await client
      .from('delivery_offers')
      .select('rider_profile_id')
      .eq('request_id', requestId)
      .eq('status', 'active');

    if (activeOffersError) {
      // শুধু রিপোর্ট — বাতিল সফল, কিন্তু অফার দেওয়া হিরোদের জানানো যায়নি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_cancel_active_offers',
        title: 'রিকোয়েস্ট বাতিল: অফার দেওয়া হিরোদের তালিকা পড়া ব্যর্থ',
        message: activeOffersError.message,
        code: activeOffersError.code,
        status: 200,
      });
    }

    const { client: adminClient } = getAdminClient();
    if (adminClient) {
      const riderProfileIds = (activeOffers || []).map((o) => o.rider_profile_id).filter(Boolean);
      const categoryLabel = updated.category === 'ride' ? 'রাইড' : 'ডেলিভারি';
      await sendBulkNotifications(adminClient, riderProfileIds, () => ({
        message: `দুঃখিত, একটা ${categoryLabel} রিকোয়েস্ট কাস্টমার বাতিল করে দিয়েছেন`,
        category: 'rider_offer',
        actionUrl: updated.category === 'ride' ? '/ride-hero' : '/delivery-hero',
        relatedEntityType: 'delivery_request',
        relatedEntityId: requestId,
        senderType: 'system',
      }));
    }

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
      action: 'delivery_cancel_unexpected',
      title: 'রিকোয়েস্ট বাতিল: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
