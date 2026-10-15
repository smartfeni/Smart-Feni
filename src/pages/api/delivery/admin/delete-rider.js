// path: src/pages/api/delivery/admin/delete-rider.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_admin_delete_rider_unlink, delivery_admin_delete_rider, delivery_admin_delete_rider_unexpected।
// ৪০৩ (অ্যাডমিন না), ৪০০ (riderId নেই) এবং has_history (FK ২৩৫০৩, স্বাভাবিক পরিস্থিতি) রিপোর্ট হয় না।
// service role কী না থাকলে রিপোর্ট করার মতো client-ই থাকে না — সেটা আগের মতোই ৫০০ রেসপন্স।
// রেসপন্স ও লজিক অপরিবর্তিত।
//
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
import { reportServerError } from '../../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/admin/delete-rider';

export async function POST({ request }) {
  // এরর রিপোর্টের ক্লায়েন্ট: service role client পাওয়ার পর সেট হয়
  let reportClient = null;

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
    reportClient = adminClient;

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
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_admin_delete_rider_unlink',
          title: 'রাইডার জোরপূর্বক ডিলিট: রেফারেন্স সরাতে ব্যর্থ',
          message: unlinkError.message,
          code: unlinkError.code,
          status: 500,
        });
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
      await reportServerError(reportClient, {
        route: ROUTE,
        action: 'delivery_admin_delete_rider',
        title: 'রাইডার ডিলিট ব্যর্থ',
        message: deleteError.message,
        code: deleteError.code,
        status: 400,
      });
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
    // admin client পাওয়ার আগেই ক্র্যাশ করলে reportClient নেই — তখন নতুন করে চেষ্টা
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
      action: 'delivery_admin_delete_rider_unexpected',
      title: 'রাইডার ডিলিট: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
