// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার নিজের প্রস্তাবিত মূল্য বাড়াবে
// (/api/delivery/update-asking-price)
// নিয়ম: শুধু বাড়ানো যাবে, কমানো যাবে না — কমাতে চাইলে
// রিকোয়েস্ট বাতিল করে নতুন করে পোস্ট করতে হবে।
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

    const { requestId, newPrice } = await request.json();

    if (!requestId || !newPrice) {
      return new Response(
        JSON.stringify({ error: 'requestId ও newPrice আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const price = Number(newPrice);
    if (!Number.isFinite(price) || price <= 0) {
      return new Response(
        JSON.stringify({ error: 'সঠিক দাম দাও' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // RLS নিজেই নিশ্চিত করবে এটা এই কাস্টমারের নিজের রিকোয়েস্ট কিনা
    const { data: reqRow, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, customer_asking_price, customer_profile_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError || !reqRow) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.customer_profile_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'এটা তোমার রিকোয়েস্ট না' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (reqRow.status !== 'open') {
      return new Response(
        JSON.stringify({ error: 'এই রিকোয়েস্ট আর খোলা নাই' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const currentAsking = Number(reqRow.customer_asking_price);
    if (price <= currentAsking) {
      return new Response(
        JSON.stringify({ error: `বর্তমান দামের (৳${currentAsking}) চেয়ে বেশি দিতে হবে, কমানো যাবে না` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: updated, error: updateError } = await client
      .from('delivery_requests')
      .update({ customer_asking_price: price, updated_at: new Date().toISOString() })
      .eq('id', requestId)
      .eq('status', 'open')
      .select()
      .single();

    if (updateError || !updated) {
      return new Response(
        JSON.stringify({ error: 'দাম আপডেট ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
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
