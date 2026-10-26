// src/pages/api/chat-order.ts
// AI চ্যাট থেকে ম্যানুয়াল অর্ডার জমা — শুধু ইউজারের "অর্ডার কনফার্ম করুন" বাটন থেকে ডাকা হয়।
// AI নিজে কখনো অর্ডার জমা দিতে পারে না: এই রুট ইউজারের নিজের লগইন টোকেনে
// সিকিউর RPC `submit_ai_manual_order` কল করে (auth.uid(), দৈনিক সীমা ও ভ্যালিডেশন ডাটাবেজে)।
// ইউজারের লেখা তথ্য এখানে লগ বা এরর রিপোর্টে যায় না।

export const prerender = false;

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { reportServerError } from '../../lib/serverErrorReporter.js';

const MAX_BODY_CHARS = 8000;

const MESSAGES: Record<string, string> = {
  login_required: 'অর্ডার দিতে আগে লগইন করুন।',
  invalid_name: 'নামটি ঠিক নেই। নামটি আবার লিখুন।',
  invalid_phone: 'ফোন নম্বরটি ঠিক নেই। ১১ ডিজিটের নম্বর দিন (যেমন 01XXXXXXXXX)।',
  invalid_address: 'ডেলিভারির ঠিকানাটি আরেকটু বিস্তারিত লিখুন।',
  invalid_details: 'কী লাগবে সেটা আরেকটু বিস্তারিত লিখুন।',
  invalid_pickup: 'কোথা থেকে নেওয়া হবে সেই লেখাটি অনেক বড়, ছোট করে লিখুন।',
  invalid_link: 'ম্যাপ লিংকটি অনেক বড়, ছোট লিংক দিন।',
  invalid_time: 'সময়টি ঠিক নেই। কখন লাগবে আবার জানান।',
  daily_limit_reached: 'আজকের জন্য অর্ডারের সীমা শেষ হয়েছে। জরুরি হলে সরাসরি যোগাযোগ করুন।',
};

const GENERIC_FAIL = 'দুঃখিত, অর্ডারটি জমা দেওয়া যায়নি। একটু পরে আবার চেষ্টা করুন অথবা সরাসরি যোগাযোগ করুন।';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

const str = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

export const POST: APIRoute = async ({ request }) => {
  const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
  const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

  const reportDb =
    supabaseUrl && serviceKey
      ? createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
      : null;
  const report = (action: string, title: string, message: string, code?: string | number, status?: number) =>
    reportServerError(reportDb, { route: '/api/chat-order', action, title, message, code, status });

  try {
    if (!supabaseUrl || !anonKey) {
      await report('chat_order_env_missing', 'AI অর্ডার: env নেই', 'supabase url/anon key missing');
      return json({ ok: false, message: GENERIC_FAIL }, 500);
    }

    const token = (request.headers.get('Authorization') || '').replace('Bearer ', '').trim();
    if (!token) return json({ ok: false, message: MESSAGES.login_required }, 401);

    const raw = await request.text();
    if (raw.length > MAX_BODY_CHARS) return json({ ok: false, message: 'তথ্য অনেক বড়।' }, 413);

    let body: any;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ ok: false, message: 'অনুরোধ বোঝা যায়নি।' }, 400);
    }

    const d = body?.draft || {};
    const isAsap = d?.is_asap !== false;
    let scheduledAt: string | null = null;
    if (!isAsap) {
      const t = new Date(str(d?.scheduled_at, 40));
      if (isNaN(t.getTime())) return json({ ok: false, message: MESSAGES.invalid_time }, 200);
      scheduledAt = t.toISOString();
    }

    const userDb = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userErr } = await userDb.auth.getUser(token);
    if (userErr || !userData?.user) return json({ ok: false, message: MESSAGES.login_required }, 401);

    const { data, error } = await userDb.rpc('submit_ai_manual_order', {
      p_customer_name: str(d?.customer_name, 120),
      p_customer_phone: str(d?.customer_phone, 30),
      p_drop_address: str(d?.drop_address, 500),
      p_details: str(d?.details, 2000),
      p_pickup_name: str(d?.pickup_name, 200) || null,
      p_drop_map_link: str(d?.drop_map_link, 500) || null,
      p_pickup_map_link: null,
      p_is_asap: isAsap,
      p_scheduled_at: scheduledAt,
    });

    if (error) {
      const msg = String(error.message || '');
      const key = Object.keys(MESSAGES).find((k) => msg.includes(k));
      if (key) return json({ ok: false, message: MESSAGES[key] }, 200);
      console.error('chat-order: rpc failed', msg);
      await report('chat_order_rpc', 'AI অর্ডার: জমা দিতে ব্যর্থ', msg.slice(0, 160), error.code);
      return json({ ok: false, message: GENERIC_FAIL }, 200);
    }

    const orderNo = String((data as any)?.order_no || '');
    return json({
      ok: true,
      order_no: orderNo,
      message: `✅ আপনার অর্ডারটি জমা হয়েছে${orderNo ? ` (${orderNo})` : ''}। আপনার অর্ডারটি সম্পর্কে শীঘ্রই আপনার সাথে যোগাযোগ করে কনফার্ম করা হবে।`,
    });
  } catch (err: any) {
    console.error('chat-order: unexpected error', err?.message || err);
    await report('chat_order_unexpected', 'AI অর্ডার: অপ্রত্যাশিত এরর', `${err?.name || 'Error'}: ${String(err?.message || err).slice(0, 100)}`);
    return json({ ok: false, message: GENERIC_FAIL }, 200);
  }
};
