// ============================================================
// API এন্ডপয়েন্ট: নতুন শপ ওউনার অ্যাকাউন্ট তৈরি (/api/create-shop)
// শুধু এডমিন প্যানেল থেকে কল হবে। Service role key ব্যবহার করে
// Supabase Auth এ সরাসরি ইউজার তৈরি করে, তারপর profiles টেবিলে
// is_shop_owner ও shop_name সেট করে দেয়।
// এই key কখনো ব্রাউজারে পাঠানো হয় না — শুধু এই সার্ভার ফাইলেই থাকে।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { shopName, phone, password } = await request.json();

    if (!shopName || !phone || !password) {
      return new Response(
        JSON.stringify({ error: 'শপের নাম, ফোন নম্বর ও পাসওয়ার্ড আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই (service role key পাওয়া যায়নি)' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // এডমিন ক্লায়েন্ট — শুধু এই সার্ভার ফাইলেই থাকবে, কখনো ব্রাউজারে যাবে না
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const digitsOnly = phone.replace(/\D/g, '');
    const email = `${digitsOnly}@smartfeni.local`;

    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: shopName, phone },
    });

    if (createError) {
      const message = createError.message.includes('already been registered')
        ? 'এই ফোন নম্বরে আগে থেকেই অ্যাকাউন্ট আছে'
        : 'অ্যাকাউন্ট তৈরি ব্যর্থ: ' + createError.message;
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        is_shop_owner: true,
        shop_name: shopName,
        shop_active: true,
      })
      .eq('id', userData.user.id);

    if (profileError) {
      return new Response(
        JSON.stringify({ error: 'অ্যাকাউন্ট তৈরি হয়েছে কিন্তু প্রোফাইল আপডেট ব্যর্থ: ' + profileError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, userId: userData.user.id, phone, shopName }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}