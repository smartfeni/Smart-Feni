// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার "রিসিভড" বাটন চাপবে (/api/delivery/mark-received)
// status: confirmed -> delivered
// এরপর রাইডারকে কনফার্ম করতে হবে (confirm-delivery.js) তবেই status completed হবে।
// কাস্টমার নিজের রিকোয়েস্টেই এটা করতে পারবে (RLS নিজেই নিশ্চিত করে)।
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';

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

    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, customer_profile_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !deliveryRequest) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি বা এটা তোমার নিজের রিকোয়েস্ট না' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.status !== 'confirmed') {
      return new Response(
        JSON.stringify({ error: 'শুধু কনফার্মড ডেলিভারিকে রিসিভড মার্ক করা যাবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: updated, error: updateError } = await client
      .from('delivery_requests')
      .update({ status: 'delivered', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'confirmed')
      .select()
      .single();

    if (updateError || !updated) {
      return new Response(
        JSON.stringify({ error: 'আপডেট ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // TODO: রাইডারকে নোটিফিকেশন — "কাস্টমার রিসিভড মার্ক করেছে, কনফার্ম করো"

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