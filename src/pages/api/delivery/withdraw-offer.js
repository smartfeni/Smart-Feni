// ============================================================
// API এন্ডপয়েন্ট: রাইডার নিজের অফার/কাউন্টার তুলে নিবে
// (/api/delivery/withdraw-offer)
// শুধু status IN ('pending','negotiating') থাকা নিজের থ্রেড
// withdraw করা যাবে — একবার accept হয়ে গেলে (confirmed) আর
// withdraw করা যাবে না, তখন raise-dispute ফ্লো দিয়ে হ্যান্ডল হবে।
// থ্রেড status -> 'rejected' এ চলে যায়, যাতে কাস্টমার সেই থ্রেড
// আর দেখতে না পায় (my-orders.astro এর filter এ শুধু
// pending/negotiating দেখানো হয়)।
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

    // নিজের থ্রেড খুঁজে বের করা — RLS নিজেই নিশ্চিত করবে এটা এই রাইডারের নিজের অফার কিনা
    const { data: offer, error: offerFetchError } = await client
      .from('delivery_offers')
      .select('id, status, rider_profile_id')
      .eq('request_id', requestId)
      .eq('rider_profile_id', user.id)
      .maybeSingle();

    if (offerFetchError || !offer) {
      return new Response(
        JSON.stringify({ error: 'তোমার কোনো অফার পাওয়া যায়নি এই রিকোয়েস্টে' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (!['pending', 'negotiating'].includes(offer.status)) {
      return new Response(
        JSON.stringify({ error: 'এই অফার আর withdraw করা যাবে না (হয়তো ইতিমধ্যে accept/reject হয়ে গেছে)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: updated, error: updateError } = await client
      .from('delivery_offers')
      .update({ status: 'rejected', updated_at: new Date().toISOString() })
      .eq('id', offer.id)
      .in('status', ['pending', 'negotiating'])
      .select()
      .single();

    if (updateError || !updated) {
      return new Response(
        JSON.stringify({ error: 'অফার withdraw ব্যর্থ: ' + (updateError?.message || 'অজানা কারণ') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, offer: updated }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}