// path: src/pages/api/delivery/withdraw-offer.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_withdraw_offer_lookup, delivery_withdraw_update, delivery_withdraw_unexpected।
// ৪০০/৪০১/৪০৪ এবং রেস কন্ডিশন (PGRST116) রিপোর্ট হয় না। রেসপন্স ও লজিক অপরিবর্তিত।
//
// ============================================================
// API এন্ডপয়েন্ট: হিরো নিজের সক্রিয় অফার তুলে নিবে
// (/api/delivery/withdraw-offer)
// শুধু status='active' এবং created_at ১ মিনিটের মধ্যে হলেই
// withdraw করা যাবে (ভুল এন্ট্রি সাথে সাথে ঠিক করার জন্য) —
// ১ মিনিট পার হয়ে গেলে আর withdraw করা যাবে না।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/withdraw-offer';
const WITHDRAW_WINDOW_MS = 60 * 1000;

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

    const { data: offer, error: offerFetchError } = await client
      .from('delivery_offers')
      .select('id, status, rider_profile_id, created_at')
      .eq('request_id', requestId)
      .eq('rider_profile_id', user.id)
      .maybeSingle();

    if (offerFetchError) {
      // শুধু DB এরর রিপোর্ট; "অফার নেই" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_withdraw_offer_lookup',
        title: 'অফার withdraw: অফার পড়া ব্যর্থ',
        message: offerFetchError.message,
        code: offerFetchError.code,
        status: 404,
      });
    }

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
      // PGRST116 = কোনো রো মেলেনি (চেক ও আপডেটের মাঝে অফার accept/close হয়ে গেছে, রেস) — রিপোর্ট নয়
      if (updateError && updateError.code !== 'PGRST116') {
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_withdraw_update',
          title: 'অফার withdraw ব্যর্থ',
          message: updateError.message,
          code: updateError.code,
          status: 500,
        });
      }
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
      action: 'delivery_withdraw_unexpected',
      title: 'অফার withdraw: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
