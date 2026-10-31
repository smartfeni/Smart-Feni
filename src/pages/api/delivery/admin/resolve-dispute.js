// path: src/pages/api/delivery/admin/resolve-dispute.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_admin_resolve_request_lookup, delivery_admin_resolve_update, delivery_admin_resolve_stats,
// delivery_admin_resolve_unexpected। ৪০৩ (অ্যাডমিন না), ৪০০, ৪০৪ রিপোর্ট হয় না।
// service role কী না থাকলে রিপোর্ট করার মতো client-ই থাকে না — সেটা আগের মতোই ৫০০ রেসপন্স।
// রেসপন্স ও লজিক অপরিবর্তিত (stats ফেইলে আগের মতোই অ্যাডমিনকে এরর দেখানো হয় না, শুধু এখন রিপোর্ট হয়)।
//
// ============================================================
// API এন্ডপয়েন্ট: এডমিন ডিসপিউট resolve করবে (/api/delivery/admin/resolve-dispute)
// দুইটা resolution:
//   - "resolve_completed": রাইডারের পক্ষে — status completed, stats (total_completed/
//                            total_earned) আপডেট হবে
//   - "resolve_cancelled": ডিল বাতিল — status cancelled, কারো স্ট্যাটে কিছু যোগ হবে না
// ============================================================

import { requirePermission, getAdminClient } from '../../../../lib/deliverySupabase.js';
import { reportServerError } from '../../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/admin/resolve-dispute';

export async function POST({ request }) {
  // এরর রিপোর্টের ক্লায়েন্ট: service role client পাওয়ার পর সেট হয়
  let reportClient = null;

  try {
    const { isAdmin, adminUserId, error: adminCheckError } = await requirePermission(request, 'disputes.manage');
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: adminCheckError || 'এডমিন পারমিশন নেই' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { requestId, resolution } = await request.json();

    if (!requestId || !['resolve_completed', 'resolve_cancelled'].includes(resolution)) {
      return new Response(
        JSON.stringify({ error: 'requestId ও সঠিক resolution দিতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { client: adminClient, error: adminClientError } = getAdminClient();
    if (adminClientError) {
      return new Response(JSON.stringify({ error: adminClientError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    reportClient = adminClient;

    const { data: deliveryRequest, error: reqError } = await adminClient
      .from('delivery_requests')
      .select('id, status, accepted_rider_id, final_price')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      // শুধু DB এরর রিপোর্ট; "পাওয়া যায়নি" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_admin_resolve_request_lookup',
        title: 'ডিসপিউট রিজলভ: রিকোয়েস্ট পড়া ব্যর্থ',
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

    if (deliveryRequest.status !== 'disputed') {
      return new Response(
        JSON.stringify({ error: 'শুধু disputed অবস্থায় থাকা ডেলিভারিই resolve করা যাবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const newStatus = resolution === 'resolve_completed' ? 'completed' : 'cancelled';

    const { data: updated, error: updateError } = await adminClient
      .from('delivery_requests')
      .update({
        status: newStatus,
        dispute_resolution: resolution,
        dispute_resolved_by: adminUserId,
        dispute_resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select()
      .single();

    if (updateError || !updated) {
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_admin_resolve_update',
        title: 'ডিসপিউট রিজলভ ব্যর্থ',
        message: updateError?.message || 'update থেকে কোনো রো ফেরত আসেনি',
        code: updateError?.code,
        status: 500,
      });
      return new Response(
        JSON.stringify({ error: 'রিজলভ ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // resolve_completed হলে রাইডারের stats আপডেট
    if (resolution === 'resolve_completed' && deliveryRequest.accepted_rider_id) {
      const { data: rider, error: riderFetchError } = await adminClient
        .from('delivery_riders')
        .select('total_completed, total_earned')
        .eq('id', deliveryRequest.accepted_rider_id)
        .maybeSingle();

      if (riderFetchError) {
        // শুধু রিপোর্ট — ডিসপিউট রিজলভ হয়েছে, কিন্তু রাইডারের stats আপডেট হবে না
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_admin_resolve_stats',
          title: 'ডিসপিউট রিজলভ: রাইডারের stats পড়া ব্যর্থ',
          message: riderFetchError.message,
          code: riderFetchError.code,
          status: 200,
        });
      }

      if (rider) {
        const earnedAmount = Number(deliveryRequest.final_price) || 0;
        const { error: statsError } = await adminClient
          .from('delivery_riders')
          .update({
            total_completed: (rider.total_completed || 0) + 1,
            total_earned: (Number(rider.total_earned) || 0) + earnedAmount,
          })
          .eq('id', deliveryRequest.accepted_rider_id);

        if (statsError) {
          await reportServerError(reportClient, {
            route: ROUTE,
            action: 'delivery_admin_resolve_stats',
            title: 'ডিসপিউট রিজলভ: রাইডারের stats আপডেট ব্যর্থ',
            message: statsError.message,
            code: statsError.code,
            status: 200,
          });
        }
      }
    }

    // TODO: কাস্টমার ও রাইডার দুইজনকেই নোটিফিকেশন — রেজোলিউশনের ফলাফল

    return new Response(
      JSON.stringify({ success: true, request: updated }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // admin client পাওয়ার আগেই ক্র্যাশ করলে reportClient নেই — তখন নতুন করে চেষ্টা
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
      action: 'delivery_admin_resolve_unexpected',
      title: 'ডিসপিউট রিজলভ: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
