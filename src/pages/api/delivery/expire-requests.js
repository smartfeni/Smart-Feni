// ============================================================
// API এন্ডপয়েন্ট: expired ওপেন রিকোয়েস্ট bulk cancel করা
// (/api/delivery/expire-requests)
// কোনো auth লাগে না (silent housekeeping) — my-orders ও
// delivery-hero পেজ লোড হওয়ার সময় "fire and forget" কল হয়।
// শুধু status='open' AND expires_at < now() — এই দুটোই cancelled
// এ চলে যায়। 'negotiating' স্ট্যাটাস আলাদা কিছু না, delivery_requests
// এর status সবসময় 'open' থাকে (bargaining delivery_offers এ হয়,
// মূল রিকোয়েস্টের status open-ই থাকে যতক্ষণ না accept হয়) —
// তাই শুধু 'open' চেক করলেই যথেষ্ট।
// confirmed/delivered/completed/cancelled/disputed — এসব ছোঁয়া হয় না।
// ============================================================

import { getAdminClient } from '../../../lib/deliverySupabase.js';

export const prerender = false;

export async function POST() {
  try {
    const { client: adminClient, error: adminError } = getAdminClient();
    if (adminError) {
      return new Response(JSON.stringify({ error: adminError }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const nowIso = new Date().toISOString();

    const { data, error } = await adminClient
      .from('delivery_requests')
      .update({ status: 'cancelled', updated_at: nowIso })
      .eq('status', 'open')
      .lt('expires_at', nowIso)
      .select('id');

    if (error) {
      return new Response(
        JSON.stringify({ error: 'এক্সপায়ার চেক ব্যর্থ: ' + error.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, expiredCount: data?.length || 0 }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}