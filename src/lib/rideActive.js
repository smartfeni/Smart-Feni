// path: src/lib/rideActive.js
// ============================================================
// যাত্রীর চলমান লোকাল রাইড খোঁজা (SF, ২৭ নভে ২০২৬: "চলমান রাইড দেখার অপশন খুঁজে পায় না")
// চলমান = খোঁজা চলছে (open, মেয়াদ শেষ হয়নি) বা কনফার্ম (চালক আসছে/পৌঁছেছে/যাত্রা চলছে)।
// RLS local_requests_read: যাত্রী শুধু নিজের রিকোয়েস্ট পড়তে পারে।
// ব্যবহার: /services/local-ride ও /ride-এ "চলমান রাইড" কার্ড → /ride/trip?id=
// ============================================================
import { supabase } from './supabase.js';

export function tripUrl(id) {
  return '/ride/trip?id=' + encodeURIComponent(id);
}

// রিটার্ন: [{ id, status, label }] — নতুনটা আগে; লগইন না থাকলে বা ভুলে []
export async function fetchActiveRides() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return [];
    const { data, error } = await supabase
      .from('local_ride_requests')
      .select('id, status, expires_at, arrived_at, started_at, created_at')
      .eq('customer_id', session.user.id)
      .in('status', ['open', 'confirmed'])
      .order('created_at', { ascending: false })
      .limit(3);
    if (error || !data) return [];
    const now = Date.now();
    return data
      .filter((r) => r.status === 'confirmed' || (r.expires_at && new Date(r.expires_at).getTime() > now))
      .map((r) => ({
        id: r.id,
        status: r.status,
        label: r.status === 'open'
          ? 'চালক খোঁজা হচ্ছে'
          : r.started_at
            ? 'যাত্রা চলছে'
            : r.arrived_at
              ? 'চালক পিকআপে পৌঁছেছেন'
              : 'চালক আসছেন',
      }));
  } catch (_) {
    return [];
  }
}
