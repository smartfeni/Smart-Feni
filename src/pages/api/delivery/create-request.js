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

// ============================================================
// কুইক ডেলিভারি: শপ অর্ডারের প্রস্তুতি (সার্ভার-সাইড)
// - এক কার্টে এক দোকান; দোকান খোলা কিনা (খোলার সময়/ছুটি) সার্ভারে যাচাই
// - পিকআপ = দোকানের পিন; চার্জ = calc_delivery_fare (দোকান → ড্রপ)
// - প্রোফাইলে বৈধ বাংলাদেশি মোবাইল নম্বর বাধ্যতামূলক
// - একসাথে সর্বোচ্চ ২টা চলমান কুইক অর্ডার
// - টেস্ট শপ: শুধু স্টাফ (DB trigger delivery_normalize_items-ও আটকায়)
// ============================================================
const MARKET_MAX_ACTIVE = 2;
const MARKET_FALLBACK_FARE = 60;
// পিন ছাড়া (লিখিত) ঠিকানায় চার্জ হিসাব হয় না → কাস্টমার নিজে প্রস্তাব দেয় (সীমার মধ্যে)
const CUST_FARE_MIN = 40;
const CUST_FARE_MAX = 500;
function customerFareOf(v) {
  const n = parseInt(String(v === null || v === undefined ? '' : v).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d)), 10);
  return Number.isFinite(n) && n >= CUST_FARE_MIN && n <= CUST_FARE_MAX ? n : null;
}
const CUST_FARE_ERR = { error: 'ঠিকানা ম্যাপে না থাকায় ডেলিভারি চার্জ প্রস্তাব দিন (৳৪০–৫০০)', code: 'CUSTOMER_FARE', status: 400 };

function dhakaOpenNow(shop) {
  if (shop.is_open === false) return false;
  if (shop.busy_until && new Date(shop.busy_until).getTime() > Date.now()) return false;
  const dh = new Date(Date.now() + 6 * 3600 * 1000);
  if (shop.weekly_off !== null && shop.weekly_off !== undefined && Number(shop.weekly_off) === dh.getUTCDay()) return false;
  const mins = (t) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
    return m ? parseInt(m[1], 10) * 60 + parseInt(m[2], 10) : null;
  };
  const o = mins(shop.opens_at);
  const c = mins(shop.closes_at);
  if (o === null || c === null || o === c) return true;
  const cur = dh.getUTCHours() * 60 + dh.getUTCMinutes();
  return o < c ? cur >= o && cur < c : cur >= o || cur < c;
}

async function prepareMarketOrder(client, user, body) {
  const admin = getAdminClient().client || client;
  const items = Array.isArray(body.orderItems) ? body.orderItems : [];
  const ids = items.map((it) => String((it && it.item_id) || '')).filter(Boolean).slice(0, 40);
  if (!ids.length) return { error: 'কার্টে কোনো আইটেম নেই', code: 'EMPTY_CART' };
  const dropAddress = typeof body.dropAddress === 'string' ? body.dropAddress.trim() : '';
  if (!dropAddress) return { error: 'ডেলিভারি ঠিকানা দিন', code: 'DROP_REQUIRED' };

  const { data: rows, error: itemErr } = await admin
    .from('delivery_shop_items')
    .select('id, name, shop_id, is_available')
    .in('id', ids);
  if (itemErr) return { error: 'আইটেম যাচাই করা যায়নি, আবার চেষ্টা করুন', status: 500 };
  const shopIds = [...new Set((rows || []).map((r) => r.shop_id))];
  if (shopIds.length !== 1) return { error: 'এক অর্ডারে এক দোকানের আইটেম দিন', code: 'ONE_SHOP' };

  const { data: shop } = await admin
    .from('delivery_shops')
    .select('id, name, address, upazila, union_name, lat, lng, is_active, is_test, is_open, busy_until, opens_at, closes_at, weekly_off, delivery_kind')
    .eq('id', shopIds[0])
    .maybeSingle();
  if (!shop || (!shop.is_active && !shop.is_test)) return { error: 'দোকানটি এখন অর্ডার নিচ্ছে না', code: 'SHOP_UNAVAILABLE', status: 409 };
  if (shop.delivery_kind === 'preorder') return { error: 'এই দোকানে প্রি-অর্ডার দিতে হয়', code: 'SHOP_PREORDER', status: 409 };
  if (shop.lat === null || shop.lng === null) return { error: 'দোকানের লোকেশন সেট করা নেই', code: 'SHOP_NO_PIN', status: 409 };
  if (!dhakaOpenNow(shop)) return { error: 'দোকান এখন বন্ধ', code: 'SHOP_CLOSED', status: 409 };

  // টেস্ট শপ: শুধু স্টাফ
  if (shop.is_test) {
    const { data: staff } = await client.rpc('has_permission', { p_key: 'delivery_orders.manage' });
    if (staff !== true) return { error: 'দোকানটি এখন অর্ডার নিচ্ছে না', code: 'SHOP_UNAVAILABLE', status: 409 };
  }

  // ফোন নম্বর (প্রোফাইল)
  const { data: prof } = await admin.from('profiles').select('phone').eq('id', user.id).maybeSingle();
  const phone = String((prof && prof.phone) || '').replace(/[\s-]/g, '').replace(/^\+?88/, '');
  if (!/^01[3-9]\d{8}$/.test(phone)) {
    return { error: 'অর্ডারের আগে প্রোফাইলে আপনার মোবাইল নম্বর যোগ করুন', code: 'PHONE_REQUIRED' };
  }

  // একসাথে চলমান অর্ডারের সীমা
  const { count } = await admin
    .from('delivery_requests')
    .select('id', { count: 'exact', head: true })
    .eq('customer_profile_id', user.id)
    .eq('is_market', true)
    .in('status', ['open', 'confirmed']);
  if ((count || 0) >= MARKET_MAX_ACTIVE) {
    return { error: 'আপনার ২টা অর্ডার চলমান আছে। সেগুলো শেষ হলে নতুন অর্ডার দিন।', code: 'TOO_MANY_ACTIVE', status: 409 };
  }

  // চার্জ: দোকান → ড্রপ
  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  let fare = null;
  try {
    const { data: fr, error: fe } = await client.rpc('calc_delivery_fare', {
      p_pickup_lat: Number(shop.lat),
      p_pickup_lng: Number(shop.lng),
      p_drop_lat: num(body.dropLat),
      p_drop_lng: num(body.dropLng),
      p_drop_union: typeof body.dropUnion === 'string' ? body.dropUnion.trim().slice(0, 120) || null : null,
      p_category: 'delivery',
    });
    if (!fe && fr && Number(fr.fare) > 0) fare = Math.round(Number(fr.fare));
  } catch (_) { /* নিচে কাস্টমারের প্রস্তাব */ }
  let customerFare = false;
  if (fare === null) {
    // পিন আছে অথচ হিসাব হয়নি (নেটওয়ার্ক) → পুরনো ফলব্যাক; পিন নেই → কাস্টমারের প্রস্তাব বাধ্যতামূলক
    if (num(body.dropLat) !== null && num(body.dropLng) !== null) fare = MARKET_FALLBACK_FARE;
    else {
      fare = customerFareOf(body.customerFare);
      if (fare === null) return CUST_FARE_ERR;
      customerFare = true;
    }
  }

  const names = (rows || []).map((r) => {
    const q = items.find((it) => String(it.item_id) === r.id);
    return r.name + ' x' + Math.min(50, Math.max(1, parseInt(q && q.qty, 10) || 1));
  });
  const note = typeof body.marketNote === 'string' ? body.marketNote.trim().slice(0, 300) : '';
  const description = ('কুইক ডেলিভারি · ' + shop.name + ': ' + names.join(', ') + (note ? ' | নোট: ' + note : '')).slice(0, 1000);
  const upazila = (typeof body.upazila === 'string' && body.upazila.trim()) || shop.upazila || 'ফেনী সদর';

  let isStaff = false;
  try { const { data: st } = await client.rpc('has_permission', { p_key: 'delivery_orders.manage' }); isStaff = st === true; } catch (_) { isStaff = false; }
  return {
    isStaff,
    orderType: 'shop_order',
    isTest: !!shop.is_test,
    upazila,
    pickupAddress: shop.address || shop.name,
    pickupLat: Number(shop.lat),
    pickupLng: Number(shop.lng),
    pickupUpazila: shop.upazila || null,
    pickupUnion: shop.union_name || null,
    description,
    fare,
    customerFare,
  };
}

// ============================================================
// কুইক ডেলিভারি: অর্ডার এনিথিং (anything) ও পাঠান/এনে দাও (send)
// - কাস্টমারের ফোন বাধ্যতামূলক, একসাথে ২টা চলমান সীমা (শপ অর্ডারের মতো)
// - anything: পিকআপ = বাছাই করা দোকান (পিন) অথবা কাস্টমারের দেওয়া জায়গা/নাম; না দিলে "কাছের দোকান"
// - send: পিকআপ ঠিকানা + পিকআপের ফোন বাধ্যতামূলক; প্রাপক ঐচ্ছিক
// - চার্জ: calc_delivery_fare (পিকআপ → ড্রপ), না পেলে ফলব্যাক
// ============================================================
const BD_PHONE = /^01[3-9]\d{8}$/;
const cleanPhone = (v) => String(v || '').replace(/[\s-]/g, '').replace(/^\+?88/, '');

async function prepareMarketAny(client, user, b) {
  const admin = getAdminClient().client || client;
  const type = b.orderType === 'send' ? 'send' : 'anything';
  const text = typeof b.description === 'string' ? b.description.trim() : '';
  if (text.length < 3) return { error: type === 'send' ? 'কী পাঠাচ্ছেন লিখুন' : 'কী লাগবে লিখুন', code: 'TEXT_REQUIRED' };
  const dropAddress = typeof b.dropAddress === 'string' ? b.dropAddress.trim() : '';
  if (!dropAddress) return { error: 'ডেলিভারি ঠিকানা দিন', code: 'DROP_REQUIRED' };

  const { data: prof } = await admin.from('profiles').select('phone').eq('id', user.id).maybeSingle();
  if (!BD_PHONE.test(cleanPhone(prof && prof.phone))) {
    return { error: 'অর্ডারের আগে প্রোফাইলে আপনার মোবাইল নম্বর যোগ করুন', code: 'PHONE_REQUIRED' };
  }
  const { count } = await admin
    .from('delivery_requests')
    .select('id', { count: 'exact', head: true })
    .eq('customer_profile_id', user.id)
    .eq('is_market', true)
    .in('status', ['open', 'confirmed']);
  if ((count || 0) >= MARKET_MAX_ACTIVE) {
    return { error: 'আপনার ২টা অর্ডার চলমান আছে। সেগুলো শেষ হলে নতুন অর্ডার দিন।', code: 'TOO_MANY_ACTIVE', status: 409 };
  }

  const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const txt = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  let pickupAddress = txt(b.pickupAddress, 300);
  let pickupLat = num(b.pickupLat);
  let pickupLng = num(b.pickupLng);
  let pickupUpazila = txt(b.pickupUpazila, 60);
  let pickupUnion = txt(b.pickupUnion, 60);
  let shopName = null;

  if (type === 'anything' && b.marketShopId) {
    const { data: shop } = await admin
      .from('delivery_shops')
      .select('id, name, address, upazila, union_name, lat, lng, is_active')
      .eq('id', String(b.marketShopId))
      .maybeSingle();
    if (shop && shop.is_active) {
      shopName = shop.name;
      pickupAddress = shop.address ? shop.name + ', ' + shop.address : shop.name;
      pickupLat = num(shop.lat); pickupLng = num(shop.lng);
      pickupUpazila = shop.upazila || pickupUpazila; pickupUnion = shop.union_name || pickupUnion;
    }
  }

  let pickupPhone = null, recipientName = null, recipientPhone = null, parcelSize = null;
  if (type === 'send') {
    if (!pickupAddress) return { error: 'কোথা থেকে নেবে সেই ঠিকানা দিন', code: 'PICKUP_REQUIRED' };
    pickupPhone = cleanPhone(b.pickupPhone);
    if (!BD_PHONE.test(pickupPhone)) return { error: 'পিকআপের সঠিক মোবাইল নম্বর দিন', code: 'PICKUP_PHONE' };
    recipientName = txt(b.recipientName, 80);
    if (b.recipientPhone) {
      recipientPhone = cleanPhone(b.recipientPhone);
      if (!BD_PHONE.test(recipientPhone)) return { error: 'প্রাপকের সঠিক মোবাইল নম্বর দিন', code: 'RECIPIENT_PHONE' };
    }
    parcelSize = ['small', 'medium', 'large'].includes(b.parcelSize) ? b.parcelSize : 'small';
  }
  if (!pickupAddress) pickupAddress = 'রাইডার কাছের দোকান থেকে কিনবেন';

  let fare = null;
  try {
    const { data: fr, error: fe } = await client.rpc('calc_delivery_fare', {
      p_pickup_lat: pickupLat, p_pickup_lng: pickupLng,
      p_drop_lat: num(b.dropLat), p_drop_lng: num(b.dropLng),
      p_drop_union: txt(b.dropUnion, 120),
      p_category: 'delivery',
    });
    if (!fe && fr && Number(fr.fare) > 0) fare = Math.round(Number(fr.fare));
  } catch (_) { /* নিচে কাস্টমারের প্রস্তাব */ }
  let customerFare = false;
  if (fare === null) {
    if (num(b.dropLat) !== null && num(b.dropLng) !== null) fare = MARKET_FALLBACK_FARE;
    else {
      fare = customerFareOf(b.customerFare);
      if (fare === null) return CUST_FARE_ERR;
      customerFare = true;
    }
  }

  let isStaff = false;
  try { const { data: st } = await client.rpc('has_permission', { p_key: 'delivery_orders.manage' }); isStaff = st === true; } catch (_) { isStaff = false; }

  const SIZE_BN = { small: 'ছোট', medium: 'মাঝারি', large: 'বড়' };
  const description = (type === 'send'
    ? 'পাঠান · ' + text.slice(0, 600) + ' · সাইজ: ' + SIZE_BN[parcelSize]
    : 'যেকোনো কিছু' + (shopName ? ' · ' + shopName : '') + ' · ' + text.slice(0, 800)).slice(0, 1000);

  return {
    isStaff,
    isTest: false,
    orderType: type,
    upazila: txt(b.upazila, 60) || pickupUpazila || 'ফেনী সদর',
    pickupAddress,
    pickupLat, pickupLng, pickupUpazila, pickupUnion,
    pickupPhone, recipientName, recipientPhone, parcelSize,
    description,
    fare,
    customerFare,
  };
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

    let {
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
      // কুইক ডেলিভারি (মার্কেট) অর্ডার — marketplace ব্রান্চ
      isMarket,
      marketNote,
      orderType,
      marketShopId,
      pickupPhone,
      recipientName,
      recipientPhone,
      parcelSize,
      customerFare,
    } = await request.json();

    // ===== কুইক ডেলিভারি: শপ অর্ডার (সব দাম/পিকআপ/চার্জ সার্ভারে, ক্লায়েন্ট বিশ্বাস নয়) =====
    let market = null; // { isTest }
    if (isMarket === true) {
      const isAny = orderType === 'anything' || orderType === 'send';
      const r = isAny
        ? await prepareMarketAny(client, user, {
          orderType, description, marketShopId, pickupAddress, pickupLat, pickupLng, pickupUpazila, pickupUnion,
          pickupPhone, recipientName, recipientPhone, parcelSize,
          dropAddress, dropLat, dropLng, dropUnion, upazila, customerFare,
        })
        : await prepareMarketOrder(client, user, {
          orderItems, dropAddress, dropLat, dropLng, dropUnion, upazila, dropInstructions, marketNote, customerFare,
        });
      if (r.error) {
        return new Response(JSON.stringify({ error: r.error, code: r.code }), {
          status: r.status || 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      market = r;
      category = 'delivery';
      upazila = r.upazila;
      pickupAddress = r.pickupAddress;
      pickupLat = r.pickupLat;
      pickupLng = r.pickupLng;
      pickupUpazila = r.pickupUpazila;
      pickupUnion = r.pickupUnion;
      pickupLocSource = r.pickupLat !== null && r.pickupLat !== undefined ? 'map' : 'manual';
      description = r.description;
      if (isAny) orderItems = [];
      askingPrice = r.fare;
      vehicleType = 'any';
      isAsap = true;
      scheduledAt = null;
    }

    const finalCategory = VALID_CATEGORIES.includes(category) ? category : 'delivery';

    // রাইড এখন আলাদা সিস্টেম "লোকাল রাইড" (/local-ride-request); এখানে আর নতুন রাইড রিকোয়েস্ট নয়
    if (finalCategory === 'ride') {
      return new Response(
        JSON.stringify({ error: 'রাইড এখন "লোকাল রাইড" থেকে নিন', code: 'RIDE_MOVED' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

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
    if (market && market.customerFare) extraColumns.fare_proposed_by_customer = true;
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
    if (market) {
      extraColumns.is_market = true;
      extraColumns.order_type = market.orderType || 'shop_order';
      if (market.pickupPhone) extraColumns.pickup_contact_phone = market.pickupPhone;
      if (market.recipientName) extraColumns.drop_contact_name = market.recipientName;
      if (market.recipientPhone) extraColumns.drop_contact_phone = market.recipientPhone;
      if (market.parcelSize) extraColumns.parcel_size = market.parcelSize;
      // market_stage গার্ড-সুরক্ষিত (কাস্টমার বসাতে পারে না); null = নতুন অর্ডার
      // স্টাফের অর্ডারও অ্যাডমিন গেটে থাকে; টেস্ট শপের অর্ডার কখনো নিজে পাবলিশ হয় না (আসল রাইডার পায় না)
      extraColumns.publish_status = 'pending';
      // টেস্ট শপ বা স্টাফের (অ্যাডমিন টেস্ট) অর্ডার কখনো নিজে পাবলিশ হয় না — অ্যাডমিন হাতে পাবলিশ/অ্যাসাইন করবে
      if (market.isTest || market.isStaff) extraColumns.auto_publish_at = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
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
    if (finalCategory === 'delivery' && !market) {
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

    if (!onlineRiderCount && !(market && (market.isTest || market.isStaff))) {
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
      if (insertMsg.includes('সাময়িকভাবে বন্ধ')) {
        return new Response(JSON.stringify({ error: insertMsg, code: 'ORDER_RESTRICTED' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
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
    let heroQuery = (getAdminClient().client || client)
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
