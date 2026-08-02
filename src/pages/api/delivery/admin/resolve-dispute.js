// ============================================================
// API এন্ডপয়েন্ট: এডমিন ডিসপিউট resolve করবে (/api/delivery/admin/resolve-dispute)
// দুইটা resolution:
//   - "resolve_completed": রাইডারের পক্ষে — status completed, stats (total_completed/
//                            total_earned) আপডেট হবে
//   - "resolve_cancelled": ডিল বাতিল — status cancelled, কারো স্ট্যাটে কিছু যোগ হবে না
// ============================================================

import { requireAdmin, getAdminClient } from '../../../../lib/deliverySupabase.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { isAdmin, adminUserId, error: adminCheckError } = await requireAdmin(request);
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

    const { data: deliveryRequest, error: reqError } = await adminClient
      .from('delivery_requests')
      .select('id, status, accepted_rider_id, final_price')
      .eq('id', requestId)
      .maybeSingle();

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
      return new Response(
        JSON.stringify({ error: 'রিজলভ ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // resolve_completed হলে রাইডারের stats আপডেট
    if (resolution === 'resolve_completed' && deliveryRequest.accepted_rider_id) {
      const { data: rider } = await adminClient
        .from('delivery_riders')
        .select('total_completed, total_earned')
        .eq('id', deliveryRequest.accepted_rider_id)
        .maybeSingle();

      if (rider) {
        const earnedAmount = Number(deliveryRequest.final_price) || 0;
        await adminClient
          .from('delivery_riders')
          .update({
            total_completed: (rider.total_completed || 0) + 1,
            total_earned: (Number(rider.total_earned) || 0) + earnedAmount,
          })
          .eq('id', deliveryRequest.accepted_rider_id);
      }
    }

    // TODO: কাস্টমার ও রাইডার দুইজনকেই নোটিফিকেশন — রেজোলিউশনের ফলাফল

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