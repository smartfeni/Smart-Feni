// ============================================================
// রিকভারি ইমেইল দিয়ে লগইন — ক্লায়েন্ট হেল্পার (AuthModal ও proLogin.js একসাথে ব্যবহার করে)
// ইমেইল → ফোন খোঁজা ও পাসওয়ার্ড যাচাই সার্ভারে (/api/auth/email-login) হয়;
// ব্রাউজারে ফোন নম্বর আসে না, শুধু সেশন টোকেন — সেটা এখানে supabase-এ বসানো হয়।
// ফলাফল: { data: { user, session } } অথবা { errorMessage: 'বাংলা বার্তা' }
// ============================================================

import { supabase } from './supabase.js';

export async function signInWithRecoveryEmail(email, password) {
  let res;
  try {
    res = await fetch('/api/auth/email-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: String(email || '').trim(), password }),
    });
  } catch {
    return { errorMessage: 'ইন্টারনেটে সমস্যা, আবার চেষ্টা করুন' };
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok || !body || !body.access_token || !body.refresh_token) {
    return { errorMessage: (body && body.error) || 'লগইন ব্যর্থ, আবার চেষ্টা করুন' };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  if (error || !data || !data.user) {
    return { errorMessage: 'লগইন ব্যর্থ, আবার চেষ্টা করুন' };
  }
  return { data: { user: data.user, session: data.session } };
}
