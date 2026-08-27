// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার বর্তমান সর্বনিম্ন হিরো অফার Confirm করবে
// (/api/delivery/confirm-best-price)
// এটা হিরোর "accept-best-price" থেকে আলাদা — এটা কাস্টমার-সাইড,
// বর্তমান সর্বনিম্ন হিরো অফারকেই accepted হিসেবে সেট করে
// (confirm_customer_deal RPC দিয়ে, অ্যাটমিক)
// ============================================================

import { getAuthedUser } from '../../../lib/deliverySupabase.js';
import { sendTelegramMessage, sendTelegramBroadcast } from '../../../lib/telegramNotify.js';

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

    // জেতা হিরোকে জানানো + যারা হেরেছে তাদেরও জানানো
    const { data: reqRow } = await client
      .from('delivery_requests')
      .select('final_price, accepted_rider_id, delivery_riders!delivery_requests_accepted_rider_id_fkey(profile_id, profiles!delivery_riders_profile_id_fkey(telegram_chat_id))')
      .eq('id', requestId)
      .maybeSingle();

    const winnerProfileId = reqRow?.delivery_riders?.profile_id;
    const winnerChatId = reqRow?.delivery_riders?.profiles?.telegram_chat_id;

    if (winnerChatId) {
      await sendTelegramMessage(
        winnerChatId,
        `🎉 কাস্টমার আপনার প্রস্তাব নিশ্চিত করেছে! মূল্য: ৳${reqRow.final_price}\n\nঅ্যাপে গিয়ে বিস্তারিত দেখুন।`
      );
    }

    const { data: losingOffers } = await client
      .from('delivery_offers')
      .select('profiles!delivery_offers_rider_profile_id_fkey(telegram_chat_id)')
      .eq('request_id', requestId)
      .eq('status', 'closed_by_other')
      .neq('rider_profile_id', winnerProfileId || '');

    const losingChatIds = (losingOffers || [])
      .map((o) => o.profiles?.telegram_chat_id)
      .filter(Boolean);

    await sendTelegramBroadcast(
      losingChatIds,
      `দুঃখিত, কাস্টমার আরেকজন হিরোর প্রস্তাব নিশ্চিত করেছে। পরের বার আরেকটু কম দাম দিয়ে চেষ্টা করুন!`
    );

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
