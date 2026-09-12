// ============================================================
// API এন্ডপয়েন্ট: কাস্টমার "রিসিভড" বাটন চাপবে (/api/delivery/mark-received)
// status: confirmed -> delivered
// এরপর রাইডারকে কনফার্ম করতে হবে (confirm-delivery.js) তবেই status completed হবে।
// কাস্টমার নিজের রিকোয়েস্টেই এটা করতে পারবে (RLS নিজেই নিশ্চিত করে)।
// ============================================================

import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendNotification } from '../../../lib/notify.js';

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

    // রাইডারকে জানানো — "কাস্টমার রিসিভড মার্ক করেছে, কনফার্ম করো"
    // (accepted_rider_id হলো delivery_riders.id, প্রোফাইল আইডি না —
    // তাই আলাদা করে profile_id বের করতে হচ্ছে। কাস্টমারের নিজের client
    // দিয়ে অন্য রাইডারের প্রোফাইল পড়ার RLS নাও থাকতে পারে, তাই adminClient
    // ব্যবহার করা হলো — best-effort, ব্যর্থ হলেও মূল রেসপন্সে প্রভাব পড়বে না)
    const { client: adminClient } = getAdminClient();
    if (adminClient && updated.accepted_rider_id) {
      const { data: riderRow } = await adminClient
        .from('delivery_riders')
        .select('profile_id')
        .eq('id', updated.accepted_rider_id)
        .maybeSingle();

      if (riderRow?.profile_id) {
        const isRide = updated.category === 'ride';
        await sendNotification(adminClient, {
          userId: riderRow.profile_id,
          message: isRide
            ? 'কাস্টমার যাত্রা সম্পন্ন হিসেবে মার্ক করেছেন — ডেলিভারি কনফার্ম করে সম্পন্ন করুন'
            : 'কাস্টমার পণ্য রিসিভড মার্ক করেছেন — ডেলিভারি কনফার্ম করে সম্পন্ন করুন',
          category: 'rider_offer',
          actionUrl: isRide ? '/ride-hero' : '/delivery-hero',
          relatedEntityType: 'delivery_request',
          relatedEntityId: requestId,
          senderType: 'customer',
          senderId: user.id,
        });
      }
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