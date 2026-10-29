// path: src/pages/api/delivery/create-request.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): ৩টা ৫০০ পথে serverErrorReporter.js দিয়ে
// অ্যাডমিন এরর লগে রিপোর্ট (delivery_create_online_check, delivery_create_insert,
// delivery_create_unexpected)। ৪০০/৪০১/৪০৯ (NO_RIDER_ONLINE) রিপোর্ট হয় না — এগুলো
// ইউজারের ভুল বা স্বাভাবিক পরিস্থিতি। রেসপন্স ও লজিক অপরিবর্তিত।
//
// আপডেট (রাইডার অ্যাভেইলেবিলিটি): রিকোয়েস্ট তৈরির আগে সার্ভারে চেক —
// সিলেক্ট করা উপজেলায় (এবং নির্দিষ্ট বাহন চাইলে সেই বাহনের) কোনো
// approved + অনলাইন (ডেলিভারি/রাইডের আলাদা টগল: delivery_online / ride_online) রাইডার না থাকলে 409 + code: 'NO_RIDER_ONLINE'
// দিয়ে reject। ফ্রন্টএন্ডের নোটিশ বাইপাস করে সরাসরি API কল করলেও
// অর্ডার তৈরি হবে না।
//
// আপডেট (নিজের অর্ডার): কাস্টমার নিজেও হিরো হলে ম্যাচিং হিরো তালিকা থেকে তাকে বাদ দেওয়া হয় —
// নিজের রিকোয়েস্টের Telegram/in-app/push নোটিফিকেশন নিজের হিরো আইডিতে যাবে না।
//
// আপডেট (N19): sendBulkNotifications এ priority: 'high' যোগ — নতুন রিকোয়েস্ট মিলে যাওয়া হিরোদের কাছে জরুরি হিসেবে যাওয়া দরকার।
// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার নতুন ডেলিভারি রিকোয়েস্ট তৈরি করবে (/api/delivery/create-request)
// লগইন করা কাস্টমার কল করবে (Authorization: Bearer <token> হেডার সহ)।
// ইউজারের নিজের সেশন টোকেন দিয়ে insert হয় (RLS respect করে)।
//
// আপডেট (এই সেশন): expires_at = তৈরির সময় + ১ ঘণ্টা সেট হয় —
// এই সময়ের মধ্যে কোনো রাইডার accept না করলে রিকোয়েস্ট auto-expire
// হয়ে যাবে (expire-requests.js এই কলামটা চেক করে)। accept হয়ে
// গেলে (status='confirmed') এই expiry আর প্রযোজ্য না।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendTelegramBroadcast } from '../../../lib/telegramNotify.js';
import { sendBulkNotifications } from '../../../lib/notify.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const VALID_VEHICLE_TYPES = ['bike', 'cycle', 'cng', 'any'];
const VALID_CATEGORIES = ['delivery', 'ride'];
const EXPIRY_HOURS = 1;
const MIN_SCHEDULE_MIN = 30; // শিডিউল অর্ডার অন্তত ৩০ মিনিট পরের
const MAX_SCHEDULE_MIN = 24 * 60; // সর্বোচ্চ ২৪ ঘণ্টার মধ্যে
const ROUTE = '/api/delivery/create-request';
const WHATSAPP_NOTE = 'জরুরি প্রয়োজনে WhatsApp করুন: +8801816355833';

// অ্যাডমিন এই সেবার অর্ডার গ্রহণ বন্ধ রাখলে (site_settings accept_*_orders)
function pausedResponse(category) {
  const label = category === 'ride' ? 'রাইড' : 'ডেলিভারি';
  return new Response(
    JSON.stringify({
      error: `${label} সেবা এই মুহূর্তে বন্ধ আছে। কিছুক্ষণ পর চেষ্টা করুন। ${WHATSAPP_NOTE}`,
      code: 'SERVICE_PAUSED',
    }),
    { status: 409, headers: { 'Content-Type': 'application/json' } }
  );
}

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

    const {
      category,
      upazila,
      pickupAddress,
      pickupLat,
      pickupLng,
      pickupInstructions,
      dropAddress,
      dropLat,
      dropLng,
      dropInstructions,
      description,
      vehicleType,
      seatCount,
      askingPrice,
      // ডেলিভারি UI v2 (ঐচ্ছিক)
      dropUnion,
      pickupUpazila,
      pickupUnion,
      dropLocSource,
      pickupLocSource,
      orderItems,
      // ডেলিভারি অটো চার্জ যাচাইয়ের কোঅর্ডিনেট (ঐচ্ছিক)
      fareDropLat,
      fareDropLng,
      farePickupLat,
      farePickupLng,
      // কখন লাগবে: এখনই (isAsap=true) / পরে (isAsap=false + scheduledAt) — বাধ্যতামূলক
      isAsap,
      scheduledAt,
    } = await request.json();

    const finalCategory = VALID_CATEGORIES.includes(category) ? category : 'delivery';

    // ===== কখন লাগবে: এখনই / পরে (বাধ্যতামূলক) =====
    const timeError = (error, code) =>
      new Response(JSON.stringify({ error, code }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    if (typeof isAsap !== 'boolean') {
      return timeError('কখন লাগবে — এখনই নাকি পরে — বাছাই করুন', 'TIME_REQUIRED');
    }
    let scheduledDate = null;
    if (isAsap === false) {
      scheduledDate = scheduledAt ? new Date(scheduledAt) : null;
      if (!scheduledDate || Number.isNaN(scheduledDate.getTime())) {
        return timeError('পরে লাগলে কখন লাগবে সেই সময় বাছাই করুন', 'TIME_REQUIRED');
      }
      const diffMin = (scheduledDate.getTime() - Date.now()) / 60000;
      if (diffMin < MIN_SCHEDULE_MIN - 2) {
        return timeError('সময় অন্তত ৩০ মিনিট পরের হতে হবে', 'SCHEDULE_TOO_SOON');
      }
      if (diffMin > MAX_SCHEDULE_MIN + 5) {
        return timeError('সময় ২৪ ঘণ্টার মধ্যে হতে হবে', 'SCHEDULE_TOO_FAR');
      }
    }

    // ===== কুলডাউন (আপাতত বন্ধ) =====
    // বারবার ক্যান্সেল করা কাস্টমারদের জন্য সাময়িক ব্লক লজিক ছিল এখানে,
    // ইউজারের অনুরোধে আপাতত অফ করা হলো। দরকার হলে আবার চালু করা যাবে।

    if (!upazila || !pickupAddress || !dropAddress || !description || !askingPrice) {
      return new Response(
        JSON.stringify({ error: 'উপজেলা, পিকআপ/ড্রপ ঠিকানা, বিবরণ ও দাম আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ===== ডেলিভারি UI v2: ঐচ্ছিক নতুন কলাম (পুরনো ক্লায়েন্ট না পাঠালে কিছুই বদলায় না) =====
    // order_items শুধু [{item_id, qty}] যায়; নাম/দাম/দোকান DB trigger (delivery_normalize_items)
    // নিজে বসায়, তাই ক্লায়েন্টের পাঠানো দাম কখনো বিশ্বাস করা হয় না।
    const LOC_SOURCES = ['map', 'manual', 'link', 'current'];
    const cleanText = (v, max = 120) =>
      typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
    const extraColumns = {};
    const dropUnionClean = cleanText(dropUnion);
    const pickupUpazilaClean = cleanText(pickupUpazila);
    const pickupUnionClean = cleanText(pickupUnion);
    if (dropUnionClean) extraColumns.drop_union = dropUnionClean;
    if (pickupUpazilaClean) extraColumns.pickup_upazila = pickupUpazilaClean;
    if (pickupUnionClean) extraColumns.pickup_union = pickupUnionClean;
    if (LOC_SOURCES.includes(dropLocSource)) extraColumns.drop_loc_source = dropLocSource;
    if (LOC_SOURCES.includes(pickupLocSource)) extraColumns.pickup_loc_source = pickupLocSource;
    if (finalCategory === 'delivery' && Array.isArray(orderItems) && orderItems.length > 0) {
      const cleanItems = orderItems
        .slice(0, 40)
        .map((it) => ({
          item_id: String((it && it.item_id) || ''),
          qty: Math.min(50, Math.max(1, parseInt(it && it.qty, 10) || 1)),
        }))
        .filter((it) => it.item_id);
      if (cleanItems.length > 0) extraColumns.order_items = cleanItems;
    }

    const price = Number(askingPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return new Response(
        JSON.stringify({ error: 'সঠিক দাম দাও (০ এর বেশি সংখ্যা)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const finalVehicleType = VALID_VEHICLE_TYPES.includes(vehicleType) ? vehicleType : 'any';

    if (finalCategory === 'ride' && finalVehicleType === 'cycle') {
      return new Response(
        JSON.stringify({ error: 'রাইড রিকোয়েস্টে সাইকেল সিলেক্ট করা যাবে না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ===== ডেলিভারি অটো চার্জ: সার্ভারে সর্বনিম্ন চার্জ যাচাই (RPC calc_delivery_fare) =====
    // শুধু delivery। সেটিং বন্ধ / "এর কমে অর্ডার নয়" বন্ধ / কোঅর্ডিনেট নেই / RPC ব্যর্থ হলে অর্ডার আটকায় না।
    // কোঅর্ডিনেট: পিন থাকলে dropLat/Lng, না থাকলে ক্লায়েন্টের পাঠানো ইউনিয়ন-কেন্দ্র (fare*)।
    if (finalCategory === 'delivery') {
      try {
        const toNum = (v) => {
          if (v === null || v === undefined || v === '') return null;
          const n = Number(v);
          return Number.isFinite(n) ? n : null;
        };
        const { data: fareRes, error: fareErr } = await client.rpc('calc_delivery_fare', {
          p_pickup_lat: toNum(pickupLat) ?? toNum(farePickupLat),
          p_pickup_lng: toNum(pickupLng) ?? toNum(farePickupLng),
          p_drop_lat: toNum(dropLat) ?? toNum(fareDropLat),
          p_drop_lng: toNum(dropLng) ?? toNum(fareDropLng),
          p_drop_union: dropUnionClean,
          p_category: 'delivery',
        });
        const minFare = fareRes ? Number(fareRes.fare) : 0;
        if (!fareErr && fareRes && fareRes.enabled && fareRes.enforce_floor && minFare > 0 && price < minFare) {
          return new Response(
            JSON.stringify({
              error: `ডেলিভারি চার্জ কমপক্ষে ৳${minFare} দিতে হবে`,
              code: 'FARE_TOO_LOW',
              minFare,
            }),
            { status: 400, headers: { 'Content-Type': 'application/json' } }
          );
        }
      } catch (_) {
        // ফেয়ার চেক ব্যর্থ হলে অর্ডার চলতে দাও
      }
    }

    // ===== অ্যাডমিন সুইচ: এই সেবার অর্ডার গ্রহণ বন্ধ কিনা =====
    const { data: acceptingData } = await client.rpc('get_service_accepting');
    if (acceptingData && acceptingData[finalCategory] === false) {
      return pausedResponse(finalCategory);
    }

    // ===== অনলাইন রাইডার চেক (উপজেলা অনুযায়ী) =====
    // service role client দিয়ে গুনছি, যেন RLS-এর কারণে ভুল শূন্য না আসে
    const { client: availabilityAdmin } = getAdminClient();
    const availabilityClient = availabilityAdmin || client;

    // সেটিং delivery_rider_scope: 'all' (ডিফল্ট) হলে সব উপজেলার রাইডার ম্যাচ করবে
    let riderScopeAll = true;
    try {
      const { data: scopeRow } = await availabilityClient
        .from('site_settings')
        .select('value')
        .eq('key', 'delivery_rider_scope')
        .maybeSingle();
      riderScopeAll = !scopeRow || scopeRow.value !== 'upazila';
    } catch (_) {
      riderScopeAll = true;
    }
    const whereLabel = riderScopeAll ? 'ফেনীতে' : `${upazila}-এ`;

    let onlineQuery = availabilityClient
      .from('delivery_riders')
      .select('id', { count: 'exact', head: true })
      .eq('verification_status', 'approved')
      .eq(finalCategory === 'ride' ? 'ride_online' : 'delivery_online', true)
      .eq(finalCategory === 'ride' ? 'offers_ride' : 'offers_delivery', true);

    if (!riderScopeAll) {
      onlineQuery = onlineQuery.eq('upazila', upazila);
    }

    if (finalVehicleType !== 'any') {
      onlineQuery = onlineQuery.eq('vehicle_type', finalVehicleType);
    }

    const { count: onlineRiderCount, error: onlineError } = await onlineQuery;

    if (onlineError) {
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_create_online_check',
        title: 'ডেলিভারি রিকোয়েস্ট: রাইডার চেক ব্যর্থ',
        message: onlineError.message,
        code: onlineError.code,
        status: 500,
      });
      return new Response(
        JSON.stringify({ error: 'রাইডারদের স্ট্যাটাস যাচাই করা যায়নি, একটু পর আবার চেষ্টা করুন' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!onlineRiderCount) {
      const noRiderMessage =
        finalVehicleType !== 'any'
          ? `${whereLabel} এই বাহনের কোনো রাইডার এই মুহূর্তে সক্রিয় নেই। "যেকোনো" বেছে নিন, অথবা কিছুক্ষণ পর চেষ্টা করুন।`
          : `দুঃখিত, ${whereLabel} এই মুহূর্তে কোনো রাইডার সক্রিয় নেই। অনুগ্রহ করে কিছুক্ষণ পর চেষ্টা করুন। জরুরি প্রয়োজনে WhatsApp করুন: +8801816355833`;

      return new Response(
        JSON.stringify({ error: noRiderMessage, code: 'NO_RIDER_ONLINE' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // এখনই অর্ডার: ১ ঘণ্টা মেয়াদ। শিডিউল অর্ডার: মেয়াদ = শিডিউল সময় (রাইডার না পেলে তখন বাতিল)
    const expiresAt = (scheduledDate
      ? scheduledDate
      : new Date(Date.now() + EXPIRY_HOURS * 60 * 60 * 1000)).toISOString();

    const { data, error: insertError } = await client
      .from('delivery_requests')
      .insert({
        customer_profile_id: user.id,
        category: finalCategory,
        upazila,
        // পুরনো কলাম — ব্যাকওয়ার্ড কম্প্যাটিবিলিটি (এখনো রিডিজাইন না হওয়া UI এর জন্য)
        area_detail: dropAddress,
        pickup_address: pickupAddress,
        pickup_lat: pickupLat || null,
        pickup_lng: pickupLng || null,
        pickup_instructions: pickupInstructions || null,
        drop_address: dropAddress,
        drop_lat: dropLat || null,
        drop_lng: dropLng || null,
        drop_instructions: dropInstructions || null,
        description,
        vehicle_type: finalVehicleType,
        seat_count: finalCategory === 'ride' ? seatCount || null : null,
        // পুরনো ও নতুন — দুই মডেলের জন্যই দাম পূরণ থাকবে
        initial_price: price,
        current_price: price,
        customer_asking_price: price,
        status: 'open',
        expires_at: expiresAt,
        is_asap: isAsap,
        scheduled_at: scheduledDate ? scheduledDate.toISOString() : null,
        ...extraColumns,
      })
      .select()
      .single();

    if (insertError) {
      // আইটেম/দোকান এর মধ্যে বন্ধ হয়ে গেলে বা আইটেম সংখ্যা বেশি হলে (trigger delivery_normalize_items)
      const insertMsg = String(insertError.message || '');
      if (insertMsg.includes('ITEM_UNAVAILABLE')) {
        return new Response(
          JSON.stringify({
            error: 'বেছে নেওয়া কোনো আইটেম এখন পাওয়া যাচ্ছে না। মেনু থেকে আবার বেছে নিন।',
            code: 'ITEM_UNAVAILABLE',
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
      if (insertMsg.includes('TOO_MANY_ITEMS')) {
        return new Response(
          JSON.stringify({ error: 'একসাথে অনেক বেশি আইটেম বেছে নেওয়া হয়েছে', code: 'TOO_MANY_ITEMS' }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      // DB trigger (trg_block_paused_service): চেক ও insert-এর মাঝে সুইচ অফ হলে
      if (String(insertError.message || '').includes('SERVICE_PAUSED')) {
        return pausedResponse(finalCategory);
      }
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_create_insert',
        title: 'ডেলিভারি রিকোয়েস্ট তৈরি ব্যর্থ',
        message: insertError.message,
        code: insertError.code,
        status: 500,
      });
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট তৈরি ব্যর্থ: ' + insertError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // পাবলিশ গেট চালু থাকলে অর্ডার 'pending' থাকে — রাইডারদের নোটিফিকেশন তখন যাবে না;
    // পাবলিশের মুহূর্তে DB (private.publish_delivery_order) নিজেই in-app + push পাঠায়
    if (data && data.publish_status && data.publish_status !== 'published') {
      return new Response(
        JSON.stringify({ success: true, request: data }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ম্যাচিং হিরোদের (category + upazila + vehicle অনুযায়ী) Telegram
    // নোটিফিকেশন — যাদের telegram_chat_id লিংক করা আছে তাদেরই যাবে,
    // অনলাইন/অফলাইন টগল নির্বিশেষে (আগের সিদ্ধান্ত অনুযায়ী)
    let heroQuery = client
      .from('delivery_riders')
      .select('profile_id, profiles!delivery_riders_profile_id_fkey(telegram_chat_id)')
      .eq('verification_status', 'approved')
      .eq(finalCategory === 'ride' ? 'offers_ride' : 'offers_delivery', true)
      // কাস্টমার নিজে হিরো হলে নিজের অর্ডারের নোটিফিকেশন (Telegram + in-app/push) নিজে পাবে না
      .neq('profile_id', user.id);

    if (finalVehicleType !== 'any') {
      heroQuery = heroQuery.eq('vehicle_type', finalVehicleType);
    }
    if (!riderScopeAll) {
      heroQuery = heroQuery.eq('upazila', upazila);
    }

    const { data: matchingHeroes } = await heroQuery;
    const chatIds = (matchingHeroes || [])
      .map((h) => h.profiles?.telegram_chat_id)
      .filter(Boolean);

    const categoryLabel = finalCategory === 'ride' ? 'রাইড' : 'ডেলিভারি';
    const whenText = scheduledDate
      ? '🕐 ' + scheduledDate.toLocaleString('bn-BD', {
          timeZone: 'Asia/Dhaka', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
        })
      : '⚡ এখনই';
    await sendTelegramBroadcast(
      chatIds,
      `🔔 নতুন ${categoryLabel} রিকোয়েস্ট!\n📍 ${upazila}\n💰 প্রস্তাবিত মূল্য: ৳${price}\n${whenText}\n\nঅ্যাপে গিয়ে অফার দিন।`
    );

    // একই ম্যাচিং হিরোদের in-app + push নোটিফিকেশন (Telegram লিংক করা
    // না থাকলেও যেন সবাই জানতে পারে) — ব্যর্থ হলেও মূল রিকোয়েস্ট
    // তৈরি আটকাবে না, তাই আলাদা try/catch ছাড়াই best-effort কল
    const matchingHeroProfileIds = (matchingHeroes || []).map((h) => h.profile_id).filter(Boolean);
    const { client: adminClient } = getAdminClient();
    if (adminClient && matchingHeroProfileIds.length > 0) {
      await sendBulkNotifications(adminClient, matchingHeroProfileIds, () => ({
        message: `নতুন ${categoryLabel} রিকোয়েস্ট এসেছে — ${upazila}, প্রস্তাবিত মূল্য ৳${price} · ${whenText}`,
        category: 'rider_offer',
        actionUrl: finalCategory === 'ride' ? '/ride-hero' : '/delivery-hero',
        relatedEntityType: 'delivery_request',
        relatedEntityId: data.id,
        senderType: 'system',
        priority: 'high',
      }));
    }

    return new Response(
      JSON.stringify({ success: true, request: data }),
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
      action: 'delivery_create_unexpected',
      title: 'ডেলিভারি রিকোয়েস্ট: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
