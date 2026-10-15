// path: src/pages/api/delivery/confirm-best-price.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_confirm_rpc, delivery_confirm_winner_fetch, delivery_confirm_losing_offers,
// delivery_confirm_unexpected। ৪০০/৪০১ রিপোর্ট হয় না। রেসপন্স ও লজিক অপরিবর্তিত।
//
// আপডেট (N19): sendNotification/sendBulkNotifications এ priority: 'high' যোগ — জেতা ও হারা হিরোকে ফলাফল সাথে সাথে জানা দরকার।
// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার বর্তমান সর্বনিম্ন হিরো অফার Confirm করবে
// (/api/delivery/confirm-best-price)
// এটা হিরোর "accept-best-price" থেকে আলাদা — এটা কাস্টমার-সাইড,
// বর্তমান সর্বনিম্ন হিরো অফারকেই accepted হিসেবে সেট করে
// (confirm_customer_deal RPC দিয়ে, অ্যাটমিক)
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendTelegramMessage, sendTelegramBroadcast } from '../../../lib/telegramNotify.js';
import { sendNotification, sendBulkNotifications } from '../../../lib/notify.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/confirm-best-price';

export async function POST({ request }) {
  // এরর রিপোর্টের ক্লায়েন্ট: লগইনের পর ইউজারের নিজের client (যাতে এরর লগে ইউজার আইডি যায়)
  let reportClient = null;

  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) {
      return new Response(JSON.stringify({ error: authError }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    reportClient = client;

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
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_confirm_rpc',
        title: 'কাস্টমার ডিল নিশ্চিত ব্যর্থ (confirm_customer_deal)',
        message: rpcError.message,
        code: rpcError.code,
        status: 500,
      });
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
    const { data: reqRow, error: reqRowError } = await client
      .from('delivery_requests')
      .select('final_price, category, accepted_rider_id, delivery_riders!delivery_requests_accepted_rider_id_fkey(profile_id, profiles!delivery_riders_profile_id_fkey(telegram_chat_id))')
      .eq('id', requestId)
      .maybeSingle();

    if (reqRowError) {
      // শুধু রিপোর্ট — ডিল নিশ্চিত হয়েছে, কিন্তু জেতা হিরোকে জানানো যাবে না
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_confirm_winner_fetch',
        title: 'ডিল নিশ্চিত: জেতা হিরোর তথ্য পড়া ব্যর্থ',
        message: reqRowError.message,
        code: reqRowError.code,
        status: 200,
      });
    }

    const winnerProfileId = reqRow?.delivery_riders?.profile_id;
    const winnerChatId = reqRow?.delivery_riders?.profiles?.telegram_chat_id;

    if (winnerChatId) {
      await sendTelegramMessage(
        winnerChatId,
        `🎉 কাস্টমার আপনার প্রস্তাব নিশ্চিত করেছে! মূল্য: ৳${reqRow.final_price}\n\nঅ্যাপে গিয়ে বিস্তারিত দেখুন।`
      );
    }

    const { data: losingOffers, error: losingOffersError } = await client
      .from('delivery_offers')
      .select('rider_profile_id, profiles!delivery_offers_rider_profile_id_fkey(telegram_chat_id)')
      .eq('request_id', requestId)
      .eq('status', 'closed_by_other')
      .neq('rider_profile_id', winnerProfileId || '');

    if (losingOffersError) {
      // শুধু রিপোর্ট — হারা হিরোদের জানানো যায়নি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_confirm_losing_offers',
        title: 'ডিল নিশ্চিত: হারা হিরোদের তালিকা পড়া ব্যর্থ',
        message: losingOffersError.message,
        code: losingOffersError.code,
        status: 200,
      });
    }

    const losingChatIds = (losingOffers || [])
      .map((o) => o.profiles?.telegram_chat_id)
      .filter(Boolean);

    await sendTelegramBroadcast(
      losingChatIds,
      `দুঃখিত, কাস্টমার আরেকজন হিরোর প্রস্তাব নিশ্চিত করেছে। পরের বার আরেকটু কম দাম দিয়ে চেষ্টা করুন!`
    );

    // জেতা হিরো + হারা হিরোদের in-app/push নোটিফিকেশন — best-effort
    const { client: adminClient } = getAdminClient();
    if (adminClient) {
      const categoryLabel = reqRow?.category === 'ride' ? 'রাইড' : 'ডেলিভারি';
      const actionUrl = reqRow?.category === 'ride' ? '/ride-hero' : '/delivery-hero';

      if (winnerProfileId) {
        await sendNotification(adminClient, {
          userId: winnerProfileId,
          message: `🎉 কাস্টমার আপনার প্রস্তাব নিশ্চিত করেছে! মূল্য: ৳${reqRow.final_price}`,
          category: 'rider_offer',
          actionUrl,
          relatedEntityType: 'delivery_request',
          relatedEntityId: requestId,
          senderType: 'customer',
          senderId: user.id,
          priority: 'high',
        });
      }

      const losingRiderProfileIds = (losingOffers || [])
        .map((o) => o.rider_profile_id)
        .filter(Boolean);

      await sendBulkNotifications(adminClient, losingRiderProfileIds, () => ({
        message: `দুঃখিত, কাস্টমার আরেকজন হিরোর প্রস্তাব নিশ্চিত করেছেন — পরের বার আরেকটু কম দাম দিয়ে চেষ্টা করুন!`,
        category: 'rider_offer',
        actionUrl,
        relatedEntityType: 'delivery_request',
        relatedEntityId: requestId,
        senderType: 'system',
        priority: 'high',
      }));
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    // লগইনের আগেই ক্র্যাশ করলে reportClient নেই — তখন service role client
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
      action: 'delivery_confirm_unexpected',
      title: 'কাস্টমার ডিল নিশ্চিত: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
