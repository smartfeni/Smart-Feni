// ============================================================
// API এন্ডপয়েন্ট: এডমিন রাইডার সম্পূর্ণ ডিলিট করবে
// (/api/delivery/admin/delete-rider)
// শুধু admin panel থেকে কল হবে। Hard delete — foreign key constraint
// থাকলে (delivery_offers/delivery_requests/delivery_reviews এ এই
// রাইডারের রেফারেন্স থাকলে) ডিলিট ব্যর্থ হবে, তখন এডমিনকে বলা হবে
// রিজেক্ট/ইনঅ্যাকটিভ করতে (soft) বরং।
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

    const { riderId } = await request.json();

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

    const { error: deleteError } = await adminClient
      .from('delivery_riders')
      .delete()
      .eq('id', riderId);

    if (deleteError) {
      // foreign key violation কোড: 23503
      const message = deleteError.code === '23503'
        ? 'এই রাইডারের ডেলিভারি/অফার/রিভিউ ইতিহাস আছে বলে সম্পূর্ণ ডিলিট করা যাচ্ছে না — এর বদলে "রিজেক্ট/ইনঅ্যাকটিভ করুন" ব্যবহার করুন'
        : 'ডিলিট ব্যর্থ: ' + deleteError.message;
      return new Response(JSON.stringify({ error: message }), {
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