// path: src/pages/api/delivery/submit-review.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_review_request_lookup, delivery_review_rider_lookup, delivery_review_insert,
// delivery_review_admin_config, delivery_review_avg, delivery_review_unexpected।
// ৪০০/৪০১/৪০৪ এবং "আগেই রিভিউ দিয়েছ" (duplicate) রিপোর্ট হয় না। রেসপন্স ও লজিক অপরিবর্তিত
// (avg_rating ফেইলে আগের মতোই ইউজারকে এরর দেখানো হয় না, শুধু এখন রিপোর্ট হয়)।
//
// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার রাইডারকে রেটিং/রিভিউ দিবে (/api/delivery/submit-review)
// শুধু status "completed" হওয়া ডেলিভারিতেই রিভিউ দেওয়া যাবে (delivery_reviews
// টেবিলের INSERT পলিসিতেই এটা এনফোর্স করা আছে)। একই request_id তে একবারই
// রিভিউ দেওয়া যাবে (UNIQUE constraint)।
// সাবমিটের পর delivery_riders.avg_rating রিক্যালকুলেট করা হয়।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/submit-review';

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

    const { requestId, rating, comment } = await request.json();

    const ratingNum = Number(rating);
    if (!requestId || !Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return new Response(
        JSON.stringify({ error: 'requestId ও ১-৫ এর মধ্যে রেটিং আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ডেলিভারি রিকোয়েস্ট থেকে rider বের করা (নিজের কিনা ও completed কিনা যাচাই হয়ে যায় RLS+status চেকে)
    const { data: deliveryRequest, error: reqError } = await client
      .from('delivery_requests')
      .select('id, status, customer_profile_id, accepted_rider_id')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      // শুধু DB এরর রিপোর্ট; "পাওয়া যায়নি/তোমার না" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_review_request_lookup',
        title: 'রিভিউ: রিকোয়েস্ট পড়া ব্যর্থ',
        message: reqError.message,
        code: reqError.code,
        status: 404,
      });
    }

    if (reqError || !deliveryRequest || deliveryRequest.customer_profile_id !== user.id) {
      return new Response(
        JSON.stringify({ error: 'রিকোয়েস্ট পাওয়া যায়নি বা এটা তোমার নিজের রিকোয়েস্ট না' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (deliveryRequest.status !== 'completed') {
      return new Response(
        JSON.stringify({ error: 'শুধু সম্পন্ন হওয়া ডেলিভারিতেই রিভিউ দেওয়া যাবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // rider এর profile_id বের করা (delivery_riders.id থেকে)
    const { data: riderRow, error: riderRowError } = await client
      .from('delivery_riders')
      .select('id, profile_id')
      .eq('id', deliveryRequest.accepted_rider_id)
      .maybeSingle();

    if (riderRowError) {
      // শুধু DB এরর রিপোর্ট; "তথ্য নেই" স্বাভাবিক পরিস্থিতি
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_review_rider_lookup',
        title: 'রিভিউ: রাইডার তথ্য পড়া ব্যর্থ',
        message: riderRowError.message,
        code: riderRowError.code,
        status: 404,
      });
    }

    if (riderRowError || !riderRow) {
      return new Response(
        JSON.stringify({ error: 'রাইডার তথ্য পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: review, error: insertError } = await client
      .from('delivery_reviews')
      .insert({
        request_id: requestId,
        rider_profile_id: riderRow.profile_id,
        customer_profile_id: user.id,
        rating: ratingNum,
        comment: comment || null,
      })
      .select()
      .single();

    if (insertError) {
      const isDuplicate = insertError.message.includes('duplicate');
      if (!isDuplicate) {
        // "আগেই রিভিউ দিয়েছ" স্বাভাবিক পরিস্থিতি; বাকি সব insert এরর রিপোর্ট
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_review_insert',
          title: 'রিভিউ সেভ ব্যর্থ',
          message: insertError.message,
          code: insertError.code,
          status: 400,
        });
      }
      const message = isDuplicate
        ? 'এই ডেলিভারিতে তুমি আগেই রিভিউ দিয়েছ'
        : 'রিভিউ সেভ ব্যর্থ: ' + insertError.message;
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // avg_rating রিক্যালকুলেট — service role দিয়ে (delivery_riders আপডেটের RLS কাস্টমারের জন্য নেই)
    const { client: adminClient, error: adminError } = getAdminClient();
    if (adminError) {
      // সার্ভিস-কী কনফিগ সমস্যা — রিভিউ সেভ হয়েছে, কিন্তু avg_rating আপডেট হবে না
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_review_admin_config',
        title: 'রিভিউ: সার্ভার কনফিগ সমস্যা (avg_rating আপডেট হয়নি)',
        message: adminError,
        status: 200,
      });
    } else {
      const { data: allReviews, error: allReviewsError } = await adminClient
        .from('delivery_reviews')
        .select('rating')
        .eq('rider_profile_id', riderRow.profile_id);

      if (allReviewsError) {
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_review_avg',
          title: 'রিভিউ: avg_rating হিসাবের জন্য রিভিউ তালিকা পড়া ব্যর্থ',
          message: allReviewsError.message,
          code: allReviewsError.code,
          status: 200,
        });
      }

      if (allReviews && allReviews.length > 0) {
        const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
        const { error: avgUpdateError } = await adminClient
          .from('delivery_riders')
          .update({ avg_rating: Math.round(avg * 100) / 100 })
          .eq('id', riderRow.id);

        if (avgUpdateError) {
          await reportServerError(reportClient, {
            route: ROUTE,
            action: 'delivery_review_avg',
            title: 'রিভিউ: রাইডারের avg_rating আপডেট ব্যর্থ',
            message: avgUpdateError.message,
            code: avgUpdateError.code,
            status: 200,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({ success: true, review }),
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
      action: 'delivery_review_unexpected',
      title: 'রিভিউ: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
