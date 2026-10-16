// path: src/pages/api/delivery/submit-offer.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_offer_hero_lookup, delivery_offer_request_lookup, delivery_offer_active_query,
// delivery_offer_upsert, delivery_offer_unexpected। ৪০০/৪০১/৪০৩/৪০৪ (ভুল দাম, আন্ডারকাট নিয়ম,
// ভেরিফাইড না, রিকোয়েস্ট নেই) রিপোর্ট হয় না। রেসপন্স ও লজিক অপরিবর্তিত।
//
// আপডেট (N19): sendNotification এ priority: 'high' যোগ — নতুন সেরা মূল্য কাস্টমারের কাছে সাথে সাথে যাওয়া দরকার।
// ============================================================
// API এন্ডপয়েন্ট: হিরো নতুন প্রতিযোগিতামূলক অফার দিবে
// (/api/delivery/submit-offer) — Smart Hero / Ride Hero "সেরা মূল্য" মডেল
//
// শর্ত:
// - প্রথম অফার (এখনো কোনো হিরো অফার নাই) — কাস্টমারের প্রস্তাবিত দামের চেয়ে বেশি হতে হবে
// - পরবর্তী অফার — বর্তমান সর্বনিম্ন হিরো অফারের চেয়ে কমপক্ষে ৳১ কম হতে হবে (আন্ডারকাট)
// একই হিরো একই রিকোয়েস্টে আগে অফার দিয়ে থাকলে upsert (নতুন রো না বানিয়ে
// পুরনোটাই আপডেট হয়, created_at রিসেট হয় — withdraw উইন্ডো নতুন করে শুরু)।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendNotification } from '../../../lib/notify.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/submit-offer';

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

    const { requestId, offerPrice } = await request.json();

    if (!requestId || !offerPrice) {
      return new Response(
        JSON.stringify({ error: 'requestId ও offerPrice আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const price = Number(offerPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return new Response(
        JSON.stringify({ error: 'সঠিক দাম দাও' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // নিজের হিরো প্রোফাইল যাচাই
    const { data: heroRow, error: heroError } = await client
      .from('delivery_riders')
      .select('id, vehicle_type, offers_delivery, offers_ride, verification_status, delivery_online, ride_online')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (heroError) {
      // শুধু DB এরর রিপোর্ট; "ভেরিফাইড না" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_offer_hero_lookup',
        title: 'হিরো অফার: হিরো প্রোফাইল পড়া ব্যর্থ',
        message: heroError.message,
        code: heroError.code,
        status: 403,
      });
    }

    if (heroError || !heroRow || heroRow.verification_status !== 'approved') {
      return new Response(
        JSON.stringify({ error: 'তুমি এখনো ভেরিফাইড হিরো না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্ট যাচাই
    const { data: reqRow, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, category, customer_asking_price, vehicle_type, customer_profile_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      // শুধু DB এরর রিপোর্ট; "পাওয়া যায়নি" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_offer_request_lookup',
        title: 'হিরো অফার: রিকোয়েস্ট পড়া ব্যর্থ',
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

    if (reqRow.status !== 'open') {
      return new Response(
        JSON.stringify({ error: 'এই রিকোয়েস্ট আর খোলা নাই' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const categoryAllowed = reqRow.category === 'ride' ? heroRow.offers_ride : heroRow.offers_delivery;
    if (!categoryAllowed) {
      return new Response(
        JSON.stringify({ error: 'এই ক্যাটাগরিতে তুমি নিবন্ধিত না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // অনলাইন চেক: এই ক্যাটাগরির (ডেলিভারি/রাইড) টগল অন না থাকলে অর্ডার নেওয়া যাবে না
    const isOnlineForCategory = reqRow.category === 'ride' ? heroRow.ride_online : heroRow.delivery_online;
    if (!isOnlineForCategory) {
      const serviceLabel = reqRow.category === 'ride' ? 'রাইড' : 'ডেলিভারি';
      return new Response(
        JSON.stringify({
          error: `তুমি এখন ${serviceLabel}-এর জন্য অফলাইন আছো। অর্ডার নিতে আগে পেজের অনলাইন টগল চালু করো, তারপর আবার চেষ্টা করো।`,
          code: 'RIDER_OFFLINE',
        }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.vehicle_type !== 'any' && reqRow.vehicle_type !== heroRow.vehicle_type) {
      return new Response(
        JSON.stringify({ error: 'তোমার বাহনের ধরন এই রিকোয়েস্টের সাথে মিলছে না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // বর্তমান সর্বনিম্ন রাইডার অফার বের করা
    const { data: activeOffers, error: activeOffersError } = await client
      .from('delivery_offers')
      .select('offer_price')
      .eq('request_id', requestId)
      .eq('status', 'active');

    if (activeOffersError) {
      // শুধু রিপোর্ট — আচরণ অপরিবর্তিত (ফেইল হলে লিস্ট ফাঁকা ধরা হয়, মানে আন্ডারকাট চেক এড়িয়ে যায়)
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_offer_active_query',
        title: 'হিরো অফার: বর্তমান অফার তালিকা পড়া ব্যর্থ',
        message: activeOffersError.message,
        code: activeOffersError.code,
        status: 200,
      });
    }

    const lowestOffer = (activeOffers || []).reduce(
      (min, o) => (o.offer_price < min ? o.offer_price : min),
      Infinity
    );

    if (lowestOffer === Infinity) {
      // এখনো কোনো হিরো অফার দেয়নি — এটাই প্রথম কাউন্টার-অফার, যেটা
      // অবশ্যই কাস্টমারের প্রস্তাবিত দামের চেয়ে বেশি হতে হবে (কাস্টমারের
      // দাম যথেষ্ট মনে না হলে হিরো বেশি দাম চাইতে পারে, এরপর অন্য হিরোরা
      // একে অপরকে আন্ডারকাট করে কমাতে থাকবে)
      const customerAsking = Number(reqRow.customer_asking_price);
      if (price <= customerAsking) {
        return new Response(
          JSON.stringify({ error: `প্রথম অফার অবশ্যই কাস্টমারের প্রস্তাবিত দামের (৳${customerAsking}) চেয়ে বেশি হতে হবে` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else if (price > lowestOffer - 1) {
      // অন্তত একটা হিরো অফার আগে থেকেই আছে — নতুন অফার অবশ্যই তার
      // চেয়ে কমপক্ষে ৳১ কম হতে হবে (হিরোরা একে অপরকে আন্ডারকাট করবে)
      return new Response(
        JSON.stringify({ error: `বর্তমান সর্বনিম্ন রাইডার অফারের (৳${lowestOffer}) চেয়ে কমপক্ষে ৳১ কম দিতে হবে` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: upserted, error: upsertError } = await client
      .from('delivery_offers')
      .upsert(
        {
          request_id: requestId,
          rider_id: heroRow.id,
          rider_profile_id: user.id,
          offer_price: price,
          status: 'active',
          last_actor: 'rider', // legacy NOT NULL কলাম, নতুন মডেলে অব্যবহৃত কিন্তু DB constraint এর জন্য দরকার
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'request_id,rider_profile_id' }
      )
      .select()
      .single();

    if (upsertError || !upserted) {
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_offer_upsert',
        title: 'হিরো অফার সেভ ব্যর্থ',
        message: upsertError?.message || 'upsert থেকে কোনো রো ফেরত আসেনি',
        code: upsertError?.code,
        status: 500,
      });
      return new Response(
        JSON.stringify({ error: 'অফার দেওয়া ব্যর্থ: ' + (upsertError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // কাস্টমারকে নতুন সেরা মূল্যের কথা জানানো — best-effort, ব্যর্থ হলেও
    // অফার সফল হয়েছে এই রেসপন্সে কোনো প্রভাব পড়বে না
    const { client: adminClient } = getAdminClient();
    if (adminClient) {
      await sendNotification(adminClient, {
        userId: reqRow.customer_profile_id,
        message: `আপনার ${reqRow.category === 'ride' ? 'রাইড' : 'ডেলিভারি'} রিকোয়েস্টে নতুন সেরা মূল্য এসেছে — ৳${price}`,
        category: 'delivery_hero',
        actionUrl: '/my-orders',
        priority: 'high',
        relatedEntityType: 'delivery_request',
        relatedEntityId: requestId,
        senderType: 'rider',
        senderId: user.id,
      });
    }

    return new Response(
      JSON.stringify({ success: true, offer: upserted }),
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
      action: 'delivery_offer_unexpected',
      title: 'হিরো অফার: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
