// ============================================================
// API এন্ডপয়েন্ট: ডেলিভারি নিয়ে ক্লেইম/সমস্যা রিপোর্ট (/api/delivery/raise-dispute)
// কাস্টমার বা রাইডার — দুইজনেই status "delivered" অবস্থায় ডিসপিউট রেইজ করতে পারবে
// (যেমন: রাইডার confirm করছে না, বা ডেলিভারি নিয়ে সমস্যা আছে)।
// status -> disputed, admin panel এ ফ্ল্যাগ হয়ে যায়, resolve-dispute.js
// দিয়ে এডমিন পরে ফাইনাল ডিসিশন দিবে।
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

    const { requestId, reason } = await request.json();

    if (!requestId || !reason) {
      return new Response(
        JSON.stringify({ error: 'requestId ও সমস্যার বিবরণ (reason) আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, customer_profile_id, accepted_rider_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !deliveryRequest) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // caller কাস্টমার নাকি রাইডার তা যাচাই — এই ডেলিভারির সাথে সম্পর্কিত কিনা
    const isCustomer = deliveryRequest.customer_profile_id === user.id;
    let isRider = false;

    if (!isCustomer) {
      const { data: rider } = await client
        .from('delivery_riders')
        .select('id')
        .eq('profile_id', user.id)
        .maybeSingle();
      isRider = rider && rider.id === deliveryRequest.accepted_rider_id;
    }

    if (!isCustomer && !isRider) {
      return new Response(
        JSON.stringify({ error: 'এই ডেলিভারির সাথে তোমার সম্পর্ক নেই' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['confirmed', 'delivered'].includes(deliveryRequest.status)) {
      return new Response(
        JSON.stringify({ error: 'এই অবস্থায় ডিসপিউট রেইজ করা যাবে না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { client: adminClient, error: adminError } = getAdminClient();
    if (adminError) {
      return new Response(JSON.stringify({ error: adminError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: updated, error: updateError } = await adminClient
      .from('delivery_requests')
      .update({
        status: 'disputed',
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (updateError || !updated) {
      return new Response(
        JSON.stringify({ error: 'ডিসপিউট রেইজ ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // TODO: reason টা কোথায় সেভ হবে তা নিয়ে ভাবা দরকার — এখন delivery_requests এ
    // কোনো "dispute_reason" কলাম নেই। চাইলে একটা কলাম যোগ করে দিব, নাহলে
    // admin_notification_log এর মতো আলাদা লগ টেবিলে রাখতে পারি।

    // TODO: এডমিনকে নোটিফিকেশন — "নতুন ডিসপিউট রিপোর্ট হয়েছে"

    return new Response(
      JSON.stringify({ success: true, request: updated }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}