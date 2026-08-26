// ============================================================
// API এন্ডপয়েন্ট: এডমিন রাইডার সম্পূর্ণ ডিলিট করবে
// (/api/delivery/admin/delete-rider)
// শুধু admin panel থেকে কল হবে।
//
// সাধারণ ডিলিট (force না থাকলে): foreign key constraint থাকলে
// (delivery_requests.accepted_rider_id এই রাইডারকে পয়েন্ট করলে)
// ডিলিট ব্যর্থ হবে, code:'has_history' সহ এরর ফেরত দিবে।
//
// force:true দিলে — আগে সব delivery_requests.accepted_rider_id
// এই রাইডারের জন্য null করে দেওয়া হয় (রিকোয়েস্ট/অর্ডার হিস্ট্রি
// নিজে মুছবে না, শুধু রাইডার-লিংক সরবে), তারপর রাইডার ডিলিট হয়
// (delivery_offers ON DELETE CASCADE বলে আলাদা করে মুছতে হয় না)।
// ============================================================

import { requireAdmin, getAdminClient } from '../../../../lib/deliverySupabase.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { isAdmin, error: adminCheckError } = await requireAdmin(request);
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: adminCheckError || 'এডমিন পারমিশন নেই' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { riderId, force } = await request.json();

    if (!riderId) {
      return new Response(
        JSON.stringify({ error: 'riderId আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { client: adminClient, error: adminClientError } = getAdminClient();
    if (adminClientError) {
      return new Response(JSON.stringify({ error: adminClientError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (force) {
      // জোরপূর্বক ডিলিট: এই রাইডার accepted_rider_id হিসেবে যেসব
      // delivery_requests-এ আছে, সেগুলার রেফারেন্স null করে দেওয়া হবে
      // (রিকোয়েস্ট/অর্ডার হিস্ট্রি নিজেই মুছবে না, শুধু রাইডার-লিংক সরবে)।
      // delivery_offers এমনিতেই ON DELETE CASCADE, আলাদা করে মুছতে হবে না।
      const { error: unlinkError } = await adminClient
        .from('delivery_requests')
        .update({ accepted_rider_id: null })
        .eq('accepted_rider_id', riderId);

      if (unlinkError) {
        return new Response(
          JSON.stringify({ error: 'জোরপূর্বক ডিলিটের আগে রেফারেন্স সরাতে ব্যর্থ: ' + unlinkError.message }),
          { status: 500, headers: { 'Content-Type': 'application/json' } }
        );
      }
    }

    const { error: deleteError } = await adminClient
      .from('delivery_riders')
      .delete()
      .eq('id', riderId);

    if (deleteError) {
      // foreign key violation কোড: 23503
      if (deleteError.code === '23503') {
        return new Response(
          JSON.stringify({
            error: 'এই রাইডারের ডেলিভারি/অফার/রিভিউ ইতিহাস আছে বলে সম্পূর্ণ ডিলিট করা যাচ্ছে না — চাইলে জোরপূর্বক ডিলিট করতে পারো (হিস্ট্রির রেফারেন্স মুছে যাবে)',
            code: 'has_history',
          }),
          { status: 400, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'ডিলিট ব্যর্থ: ' + deleteError.message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
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