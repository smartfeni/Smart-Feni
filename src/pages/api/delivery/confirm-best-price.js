// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার বর্তমান সর্বনিম্ন হিরো অফার Confirm করবে
// (/api/delivery/confirm-best-price)
// এটা হিরোর "accept-best-price" থেকে আলাদা — এটা কাস্টমার-সাইড,
// বর্তমান সর্বনিম্ন হিরো অফারকেই accepted হিসেবে সেট করে
// (confirm_customer_deal RPC দিয়ে, অ্যাটমিক)
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

    const { data: confirmed, error: rpcError } = await client.rpc('confirm_customer_deal', {
      p_request_id: requestId,
      p_customer_profile_id: user.id,
    });

    if (rpcError) {
      return new Response(
        JSON.stringify({ error: 'নিশ্চিত করা ব্যর্থ: ' + rpcError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!confirmed) {
      return new Response(
        JSON.stringify({ error: 'এখনো কোনো হিরো অফার দেয়নি, একটু অপেক্ষা করো' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
