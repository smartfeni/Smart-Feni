// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার রাইডারকে রেটিং/রিভিউ দিবে (/api/delivery/submit-review)
// শুধু status "completed" হওয়া ডেলিভারিতেই রিভিউ দেওয়া যাবে (delivery_reviews
// টেবিলের INSERT পলিসিতেই এটা এনফোর্স করা আছে)। একই request_id তে একবারই
// রিভিউ দেওয়া যাবে (UNIQUE constraint)।
// সাবমিটের পর delivery_riders.avg_rating রিক্যালকুলেট করা হয়।
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
      const message = insertError.message.includes('duplicate')
        ? 'এই ডেলিভারিতে তুমি আগেই রিভিউ দিয়েছ'
        : 'রিভিউ সেভ ব্যর্থ: ' + insertError.message;
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // avg_rating রিক্যালকুলেট — service role দিয়ে (delivery_riders আপডেটের RLS কাস্টমারের জন্য নেই)
    const { client: adminClient, error: adminError } = getAdminClient();
    if (!adminError) {
      const { data: allReviews } = await adminClient
        .from('delivery_reviews')
        .select('rating')
        .eq('rider_profile_id', riderRow.profile_id);

      if (allReviews && allReviews.length > 0) {
        const avg = allReviews.reduce((sum, r) => sum + r.rating, 0) / allReviews.length;
        await adminClient
          .from('delivery_riders')
          .update({ avg_rating: Math.round(avg * 100) / 100 })
          .eq('id', riderRow.id);
      }
    }

    return new Response(
      JSON.stringify({ success: true, review }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}