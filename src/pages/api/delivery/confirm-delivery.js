// ============================================================
// API এন্ডপয়েন্ট: রাইডার ডেলিভারি কনফার্ম করবে (/api/delivery/confirm-delivery)
// status: delivered -> completed
// এখানে delivery_riders এর stats (total_completed, total_earned) আপডেট হয়।
// রাইডারের RLS scope এ delivery_requests.status আপডেট করার পারমিশন নেই
// (শুধু কাস্টমার নিজের রিকোয়েস্ট আপডেট করতে পারে), তাই user token দিয়ে
// আগে সব validation করে, তারপর service role client দিয়ে আপডেট করা হয়েছে।
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

    if (riderError || !rider) {
      return new Response(
        JSON.stringify({ error: 'তোমার রাইডার প্রোফাইল পাওয়া যায়নি' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // রিকোয়েস্টটা এই রাইডারেরই কিনা এবং status delivered কিনা যাচাই
    const { data: deliveryRequest, error: reqError } = await client
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

    if (deliveryRequest.accepted_rider_id !== rider.id) {
      return new Response(
        JSON.stringify({ error: 'এটা তোমার ডেলিভারি না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.status !== 'delivered') {
      return new Response(
        JSON.stringify({ error: 'কাস্টমার এখনো রিসিভড মার্ক করেনি' }),
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

    const { data: updatedRequest, error: updateReqError } = await adminClient
      .from('delivery_requests')
      .update({ status: 'completed', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'delivered')
      .select()
      .single();

    if (updateReqError || !updatedRequest) {
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
    }

    return new Response(
      JSON.stringify({ success: true, request: updatedRequest }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}