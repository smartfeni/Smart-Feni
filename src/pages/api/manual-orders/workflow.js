// Manual-order workflow API. All mutations use authenticated RPCs for atomic state changes.
import { getAuthedUser, getAdminClient } from '../../../lib/deliverySupabase.js';
import { sendNotification, sendBulkNotifications } from '../../../lib/notify.js';

export const prerender = false;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

async function riderFor(client, userId) {
  const { data, error } = await client.from('delivery_riders')
    .select('id, profile_id, verification_status')
    .eq('profile_id', userId).maybeSingle();
  if (error) throw error;
  if (!data || data.verification_status !== 'approved') throw new Error('অনুমোদিত ডেলিভারি রাইডার হতে হবে');
  return data;
}

export async function GET({ request }) {
  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) return json({ error: authError }, 401);
    await riderFor(client, user.id);
    const { data, error } = await client.rpc('get_manual_order_rider_feed');
    if (error) throw error;
    return json({ orders: data || [] });
  } catch (e) {
    return json({ error: e.message || 'অর্ডার লোড করা যায়নি' }, 400);
  }
}

export async function POST({ request }) {
  try {
    const { client, user, error: authError } = await getAuthedUser(request);
    if (authError) return json({ error: authError }, 401);
    const body = await request.json();
    const action = String(body.action || '');
    const orderId = String(body.orderId || '');
    if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: 'সঠিক orderId দিন' }, 400);

    const rpcByAction = {
      publish: ['admin_publish_manual_order', { p_order_id: orderId }],
      accept: ['rider_accept_manual_order', { p_order_id: orderId }],
      ready: ['admin_mark_manual_order_ready', { p_order_id: orderId }],
      picked_up: ['rider_mark_manual_order_picked_up', { p_order_id: orderId }],
      delivered: ['rider_mark_manual_order_delivered', {
        p_order_id: orderId,
        p_cash_received: body.cashReceived,
        p_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      }],
      raise_pay: ['admin_raise_manual_order_rider_pay', { p_order_id: orderId, p_rider_pay: body.riderPay }],
      adjust_cash: ['admin_adjust_manual_order_cash', {
        p_order_id: orderId, p_cash_received: body.cashReceived,
        p_note: typeof body.note === 'string' ? body.note.slice(0, 500) : null,
      }],
      cancel: ['admin_cancel_manual_order', { p_order_id: orderId, p_reason: String(body.reason || '').slice(0, 300) }],
    };
    if (!rpcByAction[action]) return json({ error: 'অজানা action' }, 400);

    // Publishing/ready/cancel/pay notifications are sent after the atomic DB change.
    const [rpcName, rpcArgs] = rpcByAction[action];
    const { data: result, error } = await client.rpc(rpcName, rpcArgs);
    if (error) throw error;

    const { client: adminClient, error: adminError } = getAdminClient();
    if (!adminError && adminClient) {
      const { data: order } = await adminClient.from('manual_orders')
        .select('id, order_no, status, published_at, delivery_rider_id, customer_name, customer_phone, drop_address, details, scheduled_at, pickup_name, delivery_fee, rider_pay, cod_amount')
        .eq('id', orderId).maybeSingle();

      if (order) {
        const riderLink = '/offline-orders';
        if (action === 'publish') {
          const { data: riders } = await adminClient.from('delivery_riders')
            .select('profile_id').eq('verification_status', 'approved');
          const recipients = (riders || []).map(r => r.profile_id).filter(id => id && id !== user.id);
          await sendBulkNotifications(adminClient, recipients, () => ({
            message: `নতুন অফলাইন অর্ডার ${order.order_no} এসেছে। রাইডার পে ৳${order.rider_pay ?? 0} — অর্ডার দেখতে ট্যাপ করুন।`,
            category: 'rider_offer', actionUrl: riderLink,
            relatedEntityType: 'manual_order', relatedEntityId: order.id, priority: 'high',
          }));
        } else if (action === 'ready' && order.delivery_rider_id) {
          await sendNotification(adminClient, {
            userId: order.delivery_rider_id, message: `অর্ডার ${order.order_no} প্রস্তুত।`,
            category: 'rider_offer', actionUrl: riderLink,
            relatedEntityType: 'manual_order', relatedEntityId: order.id, priority: 'high',
          });
        } else if (action === 'cancel') {
          const recipients = new Set([order.delivery_rider_id].filter(Boolean));
          if (order.published_at) {
            const { data: riders } = await adminClient.from('delivery_riders')
              .select('profile_id').eq('verification_status', 'approved');
            (riders || []).forEach(r => { if (r.profile_id) recipients.add(r.profile_id); });
          }
          const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin');
          (admins || []).forEach(a => recipients.add(a.id));
          await sendBulkNotifications(adminClient, [...recipients], () => ({
            message: `অর্ডার ${order.order_no} অ্যাডমিন বাতিল করেছেন। কারণ: ${String(body.reason || '').slice(0, 160)}`,
            category: 'rider_offer', actionUrl: riderLink,
            relatedEntityType: 'manual_order', relatedEntityId: order.id, priority: 'high',
          }));
        } else if (action === 'delivered') {
          const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin');
          await sendBulkNotifications(adminClient, (admins || []).map(a => a.id), () => ({
            message: `অফলাইন অর্ডার ${order.order_no} ডেলিভারড হয়েছে। ক্যাশ: ৳${body.cashReceived ?? 0}.`,
            category: 'system', actionUrl: '/admin/manual-orders',
            relatedEntityType: 'manual_order', relatedEntityId: order.id, priority: 'normal',
          }));
        } else if (action === 'accept') {
          const { data: admins } = await adminClient.from('profiles').select('id').eq('role', 'admin');
          await sendBulkNotifications(adminClient, (admins || []).map(a => a.id), () => ({
            message: `রাইডার একটি অফলাইন অর্ডার গ্রহণ করেছেন: ${order.order_no}.`,
            category: 'system', actionUrl: '/admin/manual-orders',
            relatedEntityType: 'manual_order', relatedEntityId: order.id, priority: 'normal',
          }));
        }
      }
    }
    return json({ success: true, result });
  } catch (e) {
    const msg = e?.message || 'অনুরোধ সম্পন্ন হয়নি';
    const status = /লগইন|অনুমোদিত|পারমিশন|আপনার নয়/i.test(msg) ? 403 : 400;
    return json({ error: msg }, status);
  }
}
