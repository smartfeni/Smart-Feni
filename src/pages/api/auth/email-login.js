// ============================================================
// API এন্ডপয়েন্ট: রিকভারি ইমেইল দিয়ে লগইন (/api/auth/email-login)
//
// কেন: আগে ব্রাউজার নিজেই auth_resolve_login(email) RPC কল করে ইউজারের ফোন নম্বর
// পেত, তারপর phone@smartfeni.local দিয়ে সাইন-ইন করত। ফলে লগইন ছাড়াই যে কেউ
// কারো recovery ইমেইল দিয়ে তার ফোন নম্বর বের করতে পারত (অডিট P0, ১৯ নভে ২০২৬)।
// এখন ইমেইল → ফোন খোঁজা আর পাসওয়ার্ড যাচাই দুটোই সার্ভারে হয়; ব্রাউজারে শুধু
// সেশন টোকেন যায় (সঠিক পাসওয়ার্ড দিলে), ফোন নম্বর কখনো যায় না।
//
// ফ্লো:
//   ১) রেট লিমিট: IP প্রতি ঘণ্টায় ২০, একই ইমেইলে ঘণ্টায় ১০
//   ২) service role দিয়ে auth_resolve_login → none/multiple হলে আগের মতো বার্তা
//   ৩) anon client দিয়ে signInWithPassword (পুরনো 88… ফরম্যাটের ফলব্যাকসহ)
//   ৪) সফল হলে { access_token, refresh_token } — ক্লায়েন্ট supabase.auth.setSession() করে
// ব্লকড/ডিলিট-অপেক্ষা যাচাই আগের মতো ক্লায়েন্টেই (AuthModal / proLogin.js) হয়।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { reportServerError } from '../../../lib/serverErrorReporter.js';
import { checkRateLimit, clientIpHash, sha256Hex } from '../../../lib/rateLimit.js';

export const prerender = false;

const ROUTE = '/api/auth/email-login';
const LIMIT_IP_HOUR = 20;
const LIMIT_EMAIL_HOUR = 10;

const MSG_NOT_FOUND = 'এই ইমেইল দিয়ে কোনো একাউন্ট পাওয়া যায়নি';
const MSG_MULTIPLE = 'একাধিক একাউন্টে এই ইমেইল যুক্ত আছে, দয়া করে ফোন নাম্বার দিয়ে লগইন করুন';
const MSG_WRONG = 'লগইন ব্যর্থ: ফোন নাম্বার/ইমেইল অথবা পাসওয়ার্ড ভুল';
const MSG_TOO_MANY = 'অল্প সময়ে অনেকবার চেষ্টা হয়েছে। কিছুক্ষণ পরে আবার চেষ্টা করুন।';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function normalizeBdPhone(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('880')) d = d.slice(2);
  if (d.length === 10 && d[0] === '1') d = '0' + d;
  return d;
}

export async function POST({ request, clientAddress }) {
  let adminDb = null;
  try {
    const raw = await request.text();
    if (!raw || raw.length > 2000) return json({ error: 'অবৈধ রিকোয়েস্ট' }, 400);
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json({ error: 'অবৈধ রিকোয়েস্ট' }, 400);
    }

    const email = String(body?.email || '').trim().toLowerCase();
    const password = typeof body?.password === 'string' ? body.password : '';
    if (!email || email.length > 254 || !email.includes('@') || !password || password.length > 200) {
      return json({ error: 'ইমেইল ও পাসওয়ার্ড দিন' }, 400);
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
    const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !serviceKey || !anonKey) {
      return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);
    }

    adminDb = createClient(supabaseUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ---------- রেট লিমিট ----------
    const ipHash = await clientIpHash(request, clientAddress, serviceKey);
    const emailHash = await sha256Hex(`${serviceKey}|email|${email}`);
    const okIp = await checkRateLimit(adminDb, {
      scope: 'email_login_ip', subject: ipHash, windowMinutes: 60, limit: LIMIT_IP_HOUR, route: ROUTE,
    });
    const okEmail = okIp && (await checkRateLimit(adminDb, {
      scope: 'email_login_email', subject: emailHash, windowMinutes: 60, limit: LIMIT_EMAIL_HOUR, route: ROUTE,
    }));
    if (!okIp || !okEmail) return json({ error: MSG_TOO_MANY }, 429);

    // ---------- ইমেইল → ফোন (শুধু সার্ভারে) ----------
    const { data: resolved, error: resolveErr } = await adminDb.rpc('auth_resolve_login', { p_email: email });
    if (resolveErr) {
      await reportServerError(adminDb, {
        route: ROUTE, action: 'email_login_resolve', title: 'ইমেইল লগইন: ইমেইল খোঁজা ব্যর্থ',
        message: resolveErr.message, code: resolveErr.code, status: 500,
      });
      return json({ error: 'এই মুহূর্তে লগইন করা যাচ্ছে না, একটু পরে চেষ্টা করুন' }, 500);
    }
    if (!resolved || resolved.status === 'none' || (!resolved.phone && resolved.status !== 'multiple')) {
      return json({ error: MSG_NOT_FOUND }, 404);
    }
    if (resolved.status === 'multiple') return json({ error: MSG_MULTIPLE }, 409);

    // ---------- পাসওয়ার্ড যাচাই (anon client, সেশন সেভ হয় না) ----------
    const authClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const loginEmail = `${normalizeBdPhone(resolved.phone)}@smartfeni.local`;
    let { data, error } = await authClient.auth.signInWithPassword({ email: loginEmail, password });
    if (error && /^01\d{9}@smartfeni\.local$/.test(loginEmail)) {
      ({ data, error } = await authClient.auth.signInWithPassword({ email: '88' + loginEmail, password }));
    }

    if (error || !data?.session) {
      // ভুল পাসওয়ার্ড স্বাভাবিক; অন্য ধরনের এরর (যেমন Supabase-এর রেট লিমিট) হলে রিপোর্ট
      const msg = String(error?.message || '');
      if (error && !/invalid login credentials|invalid_credentials/i.test(msg + ' ' + (error.code || ''))) {
        await reportServerError(adminDb, {
          route: ROUTE, action: 'email_login_signin', title: 'ইমেইল লগইন: সাইন-ইন এরর',
          message: msg, code: error.code, status: error.status || 500,
        });
      }
      return json({ error: MSG_WRONG }, 401);
    }

    return json({
      ok: true,
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
    });
  } catch (err) {
    console.error('email-login API এরর:', err);
    await reportServerError(adminDb, {
      route: ROUTE, action: 'email_login_unexpected', title: 'ইমেইল লগইন: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message, status: 500,
    });
    return json({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }, 500);
  }
}
