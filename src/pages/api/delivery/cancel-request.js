// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার নিজের ওপেন রিকোয়েস্ট বাতিল করবে
// (/api/delivery/cancel-request)
// শুধু status='open' (কোনো রাইডার accept করার আগে) অবস্থাতেই
// বাতিল করা যাবে — একবার confirmed হয়ে গেলে এটা দিয়ে বাতিল
// করা যাবে না (ডিসপিউট ফ্লো দিয়ে হ্যান্ডল হবে)।
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

    if (deliveryRequest.status !== 'open') {
      return new Response(
        JSON.stringify({ error: 'শুধু ওপেন রিকোয়েস্ট বাতিল করা যাবে, ডিল কনফার্ম হয়ে গেলে বাতিল করা যায় না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: updated, error: updateError } = await client
      .from('delivery_requests')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'open')
      .select()
      .single();

    if (updateError || !updated) {
      return new Response(
        JSON.stringify({ error: 'বাতিল ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
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