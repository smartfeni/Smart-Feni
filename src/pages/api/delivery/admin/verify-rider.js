// path: src/pages/api/delivery/admin/verify-rider.js
//
// আপডেট (এরর মনিটরিং, ধাপ ৯ — ডেলিভারি গ্রুপ): serverErrorReporter.js দিয়ে অ্যাডমিন এরর লগে রিপোর্ট —
// delivery_admin_verify_rider_update, delivery_admin_verify_rider_unexpected।
// ৪০৩ (অ্যাডমিন না), ৪০০ এবং "রাইডার পাওয়া যায়নি" (PGRST116) রিপোর্ট হয় না।
// service role কী না থাকলে রিপোর্ট করার মতো client-ই থাকে না — সেটা আগের মতোই ৫০০ রেসপন্স।
// রেসপন্স ও লজিক অপরিবর্তিত।
//
// ============================================================
// API এন্ডপয়েন্ট: এডমিন রাইডার আবেদন approve/reject করবে
// (/api/delivery/admin/verify-rider)
// শুধু admin panel থেকে কল হবে। caller এর role='admin' যাচাই হওয়ার পরই
// service role client দিয়ে delivery_riders আপডেট হয়।
// ============================================================

import { requireAdminOrMod, getAdminClient } from '../../../../lib/deliverySupabase.js';
import { reportServerError } from '../../../../lib/serverErrorReporter.js';

export const prerender = false;

const ROUTE = '/api/delivery/admin/verify-rider';

export async function POST({ request }) {
  // এরর রিপোর্টের ক্লায়েন্ট: service role client পাওয়ার পর সেট হয়
  let reportClient = null;

  try {
    const { isAdmin, adminUserId, error: adminCheckError } = await requireAdminOrMod(request);
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: adminCheckError || 'এডমিন পারমিশন নেই' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { riderId, decision, rejectionReason } = await request.json();

    if (!riderId || !['approve', 'reject'].includes(decision)) {
      return new Response(
        JSON.stringify({ error: 'riderId ও সঠিক decision (approve/reject) দিতে হবে' }),
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

    const updatePayload =
      decision === 'approve'
        ? {
            verification_status: 'approved',
            is_active: true,
            reviewed_at: new Date().toISOString(),
            reviewed_by: adminUserId,
          }
        : {
            verification_status: 'rejected',
            is_active: false,
            rejection_reason: rejectionReason || null,
            reviewed_at: new Date().toISOString(),
            reviewed_by: adminUserId,
          };

    const { data: updated, error: updateError } = await adminClient
      .from('delivery_riders')
      .update(updatePayload)
      .eq('id', riderId)
      .select()
      .single();

    if (updateError || !updated) {
      // PGRST116 = রাইডার পাওয়া যায়নি (ভুল/মুছে ফেলা id) — স্বাভাবিক পরিস্থিতি, রিপোর্ট নয়
      if (updateError && updateError.code !== 'PGRST116') {
        await reportServerError(reportClient, {
          route: ROUTE,
          action: 'delivery_admin_verify_rider_update',
          title: 'রাইডার approve/reject ব্যর্থ',
          message: updateError.message,
          code: updateError.code,
          status: 500,
        });
      }
      return new Response(
        JSON.stringify({ error: 'আপডেট ব্যর্থ: ' + (updateError?.message || 'রাইডার পাওয়া যায়নি') }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // TODO: রাইডারকে নোটিফিকেশন — approve/reject এর ফলাফল জানানো

    return new Response(
      JSON.stringify({ success: true, rider: updated }),
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
      action: 'delivery_admin_verify_rider_unexpected',
      title: 'রাইডার approve/reject: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
