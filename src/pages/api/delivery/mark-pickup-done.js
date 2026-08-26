// ============================================================
// API এন্ডপয়েন্ট: রাইড হিরো পিকআপ সম্পন্ন মার্ক করবে
// (/api/delivery/mark-pickup-done)
// status='confirmed' অবস্থায়, pickup_done_at সেট করে দেয় —
// তখন থেকে হিরোর কার্ডে ড্রপ-অফ লোকেশন/দূরত্ব দেখানো শুরু হবে।
// confirm-delivery.js এর প্যাটার্ন অনুসরণ করে: রাইডারের RLS scope এ
// delivery_requests আপডেট করার পারমিশন নেই, তাই আগে user token দিয়ে
// validation করে, তারপর service role client দিয়ে আপডেট করা হয়েছে।
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

    const { data: rider, error: riderError } = await client
      .from('delivery_riders')
      .select('id')
      .eq('profile_id', user.id)
      .maybeSingle();

    if (riderError || !rider) {
      return new Response(
        JSON.stringify({ error: 'তোমার হিরো প্রোফাইল পাওয়া যায়নি' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: reqRow, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, accepted_rider_id, pickup_done_at')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !reqRow) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.accepted_rider_id !== rider.id) {
      return new Response(
        JSON.stringify({ error: 'এটা তোমার রাইড না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.status !== 'confirmed') {
      return new Response(
        JSON.stringify({ error: 'এই রাইড এখন এই ধাপে নাই' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.pickup_done_at) {
      return new Response(
        JSON.stringify({ error: 'পিকআপ ইতিমধ্যে সম্পন্ন হিসেবে মার্ক করা আছে' }),
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
      .update({ pickup_done_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'confirmed')
      .is('pickup_done_at', null)
      .select()
      .single();

    if (updateError || !updated) {
      return new Response(
        JSON.stringify({ error: 'পিকআপ মার্ক করা ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

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