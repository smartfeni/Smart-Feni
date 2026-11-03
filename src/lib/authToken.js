// path: src/lib/authToken.js
// ============================================================
// ইউটিলিটি: সবসময় "টাটকা" লগইন টোকেন + অটো-রিফ্রেশ সহ API কল
// কেন: /api/* রুটে হাতে Bearer টোকেন পাঠানো কলগুলো পুরনো/মেয়াদোত্তীর্ণ টোকেন
// পাঠালে সার্ভার ৪০১ ("সেশন যাচাই ব্যর্থ") দিত — অ্যাপ ব্যাকগ্রাউন্ড থেকে ফিরলে,
// অ্যাডমিন পেজ অনেকক্ষণ খোলা থাকলে, বা ফোনের ঘড়ি পিছিয়ে থাকলে হয়।
//
//   getFreshToken(force=false) — টোকেন মেয়াদ ২ মিনিটের কম থাকলে (বা force হলে)
//       আগে refreshSession() করে নতুন টোকেন দেয়। সেশন না থাকলে null।
//   authHeader(force) — { Authorization: 'Bearer …' } বা null (uploadWithRetry-র getAuthHeader)
//   authFetch(url, init) — fetch + টাটকা টোকেন; ৪০১ এলে একবার জোর করে রিফ্রেশ করে
//       আবার পাঠায়। init.headers-এ Authorization দেওয়া থাকলেও টাটকাটা তাকে ওভাররাইড করে।
//       সেশনই না থাকলে নেটওয়ার্কে না গিয়ে সরাসরি 401 JSON Response ফেরত দেয়।
// ============================================================

import { supabase } from './supabase.js';

const MARGIN_MS = 120000;

export async function getFreshToken(force = false) {
  try {
    if (!force) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;
      const expMs = (session.expires_at || 0) * 1000;
      if (expMs && expMs - Date.now() > MARGIN_MS) return session.access_token;
    }

    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data?.session?.access_token) return data.session.access_token;

    // রিফ্রেশ ব্যর্থ (যেমন নেট নেই): জোর না করা হলে হাতের টোকেনটাই চেষ্টা করা হয়
    if (!force) {
      const { data: { session } } = await supabase.auth.getSession();
      return session?.access_token || null;
    }
    return null;
  } catch (e) {
    return null;
  }
}

export async function authHeader(force = false) {
  const token = await getFreshToken(force);
  return token ? { Authorization: `Bearer ${token}` } : null;
}

export async function authFetch(url, init = {}) {
  const send = (token) => fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization: `Bearer ${token}` },
  });

  const token = await getFreshToken();
  if (!token) {
    return new Response(JSON.stringify({ error: 'সেশন পাওয়া যায়নি, আবার লগইন করুন' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let res = await send(token);

  if (res.status === 401) {
    const retryToken = await getFreshToken(true);
    if (retryToken && retryToken !== token) res = await send(retryToken);
  }
  return res;
}
