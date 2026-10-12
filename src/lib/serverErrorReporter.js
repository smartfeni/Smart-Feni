// src/lib/serverErrorReporter.js
// সার্ভার-সাইড (API রুট) এরর রিপোর্টার: public.report_client_error() RPC কল করে।
// ব্রাউজারের জন্য src/lib/errorReporter.js আলাদা — এটা শুধু সার্ভারে (window লাগে না)।
// (src/pages/api/*.js থেকে ইমপোর্ট পাথ '../../lib/serverErrorReporter.js'; নেস্টেড ফোল্ডারে আরেক ধাপ ওপরে)
//
// ব্যবহার (API রুটে, service-role ক্লায়েন্ট দিয়ে):
//   import { reportServerError } from '../../lib/serverErrorReporter.js';
//   await reportServerError(supabaseAdmin, {
//     route: '/api/delete-user',
//     action: 'delete_user_auth_delete',
//     title: 'ইউজার ডিলিট ব্যর্থ',
//     message: deleteError.message,
//     code: deleteError.code,
//     status: 500,
//   });
//
// গুরুত্বপূর্ণ: কল অবশ্যই await করতে হবে রেসপন্স ফেরত দেওয়ার আগে — Vercel সার্ভারলেসে
// রেসপন্সের পর ব্যাকগ্রাউন্ড কাজ কেটে যেতে পারে। সর্বোচ্চ ২ সেকেন্ড অপেক্ষা করে,
// কখনো throw করে না, তাই মূল রেসপন্সে কোনো প্রভাব ফেলে না।

const MAX_MSG = 300;
const TIMEOUT_MS = 2000;

// মেসেজ পরিষ্কার: টোকেন, ইমেইল, ফোন নম্বর ও URL query মুছে ফেলা
function scrub(message) {
  let m = String(message == null ? '' : message);
  m = m.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]');
  m = m.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  m = m.replace(/(?:\+?88)?01[3-9]\d{8}/g, '[phone]');
  m = m.replace(/[?#][^\s"')\]]*/g, '');
  m = m.replace(/\s+/g, ' ').trim();
  return m.slice(0, MAX_MSG);
}

export async function reportServerError(client, opts) {
  let timer = null;
  try {
    if (!client || typeof client.rpc !== 'function') return;

    const o = opts || {};
    const action = String(o.action || '').slice(0, 200);
    const prefix = o.status ? `HTTP ${o.status}: ` : '';
    const message = scrub(prefix + (o.message == null ? '' : o.message));
    if (!message && !action) return;

    const call = Promise.resolve(
      client.rpc('report_client_error', {
        p_kind: 'api_fail',
        p_page: String(o.route || '').slice(0, 200),
        p_action: action,
        p_message: message,
        p_code: o.code ? String(o.code).slice(0, 50) : null,
        p_title: o.title ? String(o.title).slice(0, 200) : null,
        p_user_agent: 'server',
        p_sentry_event_id: null,
      })
    );
    const timeout = new Promise((resolve) => {
      timer = setTimeout(resolve, TIMEOUT_MS);
    });

    await Promise.race([call, timeout]);
  } catch (_) {
    // রিপোর্টারের নিজের এরর কখনো বাইরে যাবে না
  } finally {
    if (timer) clearTimeout(timer);
  }
}
