// ============================================================
// Delivery Hero এর সব API route এর জন্য শেয়ার্ড Supabase client হেল্পার
// দুই ধরনের ক্লায়েন্ট বানানোর ফাংশন এখানে আছে:
// 1. getUserClient()  -> ইউজারের নিজের সেশন টোকেন দিয়ে (RLS respect করে)
// 2. getAdminClient()  -> service role key দিয়ে (RLS বাইপাস, শুধু admin route এ ব্যবহার হবে)
//
// বাগফিক্স (গুরুত্বপূর্ণ): getAuthedUser() এ client.auth.getUser()
// কল হচ্ছিল কোনো টোকেন প্যারামিটার ছাড়া। supabase-js এ getUser()
// কে জোর করে টোকেন না দিলে এটা client এর internal stored session
// থেকে টোকেন খোঁজে (localStorage/memory) — কিন্তু আমাদের এই client
// টা প্রতি রিকোয়েস্টে fresh তৈরি হয়, persistSession:false দিয়ে,
// কখনো auth.setSession() কল হয়নি। ফলে getUser() সবসময় "Auth
// session missing" এরর দিচ্ছিল, যদিও Authorization হেডারে সঠিক
// টোকেন পাঠানো হচ্ছিল। এখন getUser(token) — এক্সপ্লিসিটলি টোকেন
// পাস করা হচ্ছে, যেটা সরাসরি সেই টোকেন verify করে (session state
// এর উপর নির্ভর করে না)। এটাই ছিল create-request সহ প্রায় সব
// customer/rider/admin রুট ব্যর্থ হওয়ার মূল কারণ।
// ============================================================

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

// সাধারণ ইউজার রুটের জন্য — Authorization হেডার থেকে টোকেন নিয়ে
// anon key + user token দিয়ে client বানায়, ফলে RLS policy কাজ করে
export function getUserClient(request) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.replace('Bearer ', '').trim();

  if (!token) {
    return { client: null, token: null, error: 'লগইন টোকেন পাওয়া যায়নি (Authorization হেডার নেই)' };
  }

  if (!supabaseUrl || !anonKey) {
    return { client: null, token: null, error: 'সার্ভার কনফিগারেশন ঠিক নেই (Supabase URL/anon key পাওয়া যায়নি)' };
  }

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  return { client, token, error: null };
}

// ইউজারের টোকেন দিয়ে client বানিয়ে, সেই ইউজারের প্রোফাইল ভেরিফাই করে
// (auth.getUser(token) দিয়ে টোকেন ভ্যালিড কিনা চেক করে, id রিটার্ন করে)
export async function getAuthedUser(request) {
  const { client, token, error } = getUserClient(request);
  if (error) return { client: null, user: null, error };

  const { data, error: userError } = await client.auth.getUser(token);
  if (userError || !data?.user) {
    return { client: null, user: null, error: 'সেশন মেয়াদোত্তীর্ণ বা অবৈধ, আবার লগইন করো' };
  }

  return { client, user: data.user, error: null };
}

// এডমিন রুটের জন্য — service role key দিয়ে client বানায় (RLS বাইপাস)
export function getAdminClient() {
  if (!supabaseUrl || !serviceRoleKey) {
    return { client: null, error: 'সার্ভার কনফিগারেশন ঠিক নেই (service role key পাওয়া যায়নি)' };
  }
  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return { client, error: null };
}

// এডমিন রুটের শুরুতে কল করার জন্য — caller এর token যাচাই করে,
// তারপর profiles.role === 'admin' কিনা চেক করে
export async function requireAdmin(request) {
  const { client: userClient, user, error } = await getAuthedUser(request);
  if (error) return { isAdmin: false, adminUserId: null, error };

  const { data: profile, error: profileError } = await userClient
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single();

  if (profileError || !profile || profile.role !== 'admin') {
    return { isAdmin: false, adminUserId: null, error: 'এডমিন পারমিশন নেই' };
  }

  return { isAdmin: true, adminUserId: user.id, error: null };
}