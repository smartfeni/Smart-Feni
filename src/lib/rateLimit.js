// ============================================================
// সার্ভার API রেট লিমিট হেল্পার (শুধু সার্ভার রুটে, service role client দিয়ে)
// DB: public.check_rate_limit(scope, subject, window_minutes, limit) → true = অনুমতি আছে
//     কাউন্টার public.api_rate_limits টেবিলে (anon/authenticated-এর কোনো অ্যাক্সেস নেই)।
// IP সরাসরি সেভ হয় না, salt দিয়ে SHA-256 হ্যাশ হয়।
// RPC নিজে ফেইল করলে fail-open (ইউজার আটকায় না), কিন্তু অ্যাডমিন এরর লগে রিপোর্ট যায়।
// ============================================================

import { reportServerError } from './serverErrorReporter.js';

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ক্লায়েন্টের IP (Vercel: clientAddress বা x-forwarded-for) → হ্যাশ
export async function clientIpHash(request, clientAddress, salt) {
  let ip = '';
  try {
    ip = clientAddress || '';
  } catch {
    ip = '';
  }
  if (!ip) ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (!ip) ip = request.headers.get('x-real-ip') || 'unknown';
  return sha256Hex(`${salt || 'sf'}|ip|${ip}`);
}

// true = চলতে দাও, false = সীমা পার হয়েছে
export async function checkRateLimit(adminDb, { scope, subject, windowMinutes, limit, route }) {
  if (!adminDb) return true;
  try {
    const { data, error } = await adminDb.rpc('check_rate_limit', {
      p_scope: scope,
      p_subject: subject,
      p_window_minutes: windowMinutes,
      p_limit: limit,
    });
    if (error) throw error;
    return data !== false;
  } catch (err) {
    await reportServerError(adminDb, {
      route: route || 'rate-limit',
      action: 'rate_limit_rpc',
      title: 'রেট লিমিট চেক ব্যর্থ (fail-open)',
      message: err && err.message,
      code: err && err.code,
      status: 200,
    });
    return true;
  }
}
