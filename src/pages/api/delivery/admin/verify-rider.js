// ============================================================
// API এন্ডপয়েন্ট: এডমিন রাইডার আবেদন approve/reject করবে
// (/api/delivery/admin/verify-rider)
// শুধু admin panel থেকে কল হবে। caller এর role='admin' যাচাই হওয়ার পরই
// service role client দিয়ে delivery_riders আপডেট হয়।
// ============================================================

import { requireAdmin, getAdminClient } from '../../../../lib/deliverySupabase.js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { isAdmin, adminUserId, error: adminCheckError } = await requireAdmin(request);
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
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}