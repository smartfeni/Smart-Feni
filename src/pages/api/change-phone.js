// ============================================================
// API এন্ডপয়েন্ট: নিজের ফোন নম্বর বদলানো (/api/change-phone)
// যেকোনো লগইন করা ইউজার নিজের নম্বর বদলাতে পারবে, কিন্তু আগে
// বর্তমান পাসওয়ার্ড দিয়ে re-authenticate করতে হবে (সিকিউরিটি)।
//
// flow:
// ১. caller-এর token যাচাই (identity confirm)
// ২. caller-এর বর্তমান auth email বের করা (admin.getUserById দিয়ে)
// ৩. সেই email + দেওয়া currentPassword দিয়ে sign-in ট্রাই করে
//    পাসওয়ার্ড সঠিক কিনা যাচাই (রি-অথ)
// ৪. নতুন ফোন নম্বর থেকে নতুন ফেক ইমেইল বানিয়ে auth.admin.updateUserById
//    দিয়ে email বদলানো (email_confirm:true দিয়ে, কনফার্মেশন ইমেইল
//    ছাড়াই সাথে সাথে কার্যকর — কারণ @smartfeni.local এ রিয়েল ইমেইল
//    পৌঁছাবে না)
// ৫. profiles.phone আপডেট
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { accessToken, currentPassword, newPhone } = await request.json();

    if (!accessToken || !currentPassword || !newPhone) {
      return new Response(
        JSON.stringify({ error: 'accessToken, currentPassword ও newPhone আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const digitsOnly = newPhone.replace(/\D/g, '');
    if (digitsOnly.length < 10) {
      return new Response(
        JSON.stringify({ error: 'সঠিক ফোন নম্বর দিন' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !anonKey || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // caller-এর token দিয়ে identity যাচাই
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });

    const { data: { user: callerUser }, error: callerError } = await callerClient.auth.getUser();

    if (callerError || !callerUser) {
      return new Response(
        JSON.stringify({ error: 'অননুমোদিত — সেশন যাচাই ব্যর্থ' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const currentEmail = callerUser.email;
    const newEmail = `${digitsOnly}@smartfeni.local`;

    if (newEmail === currentEmail) {
      return new Response(
        JSON.stringify({ error: 'এটা আপনার বর্তমান নম্বরই' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // বর্তমান পাসওয়ার্ড যাচাই — একটা আলাদা anon ক্লায়েন্ট দিয়ে sign-in ট্রাই
    const reauthClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: reauthError } = await reauthClient.auth.signInWithPassword({
      email: currentEmail,
      password: currentPassword,
    });

    if (reauthError) {
      return new Response(
        JSON.stringify({ error: 'বর্তমান পাসওয়ার্ড সঠিক নয়' }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(callerUser.id, {
      email: newEmail,
      email_confirm: true,
    });

    if (updateError) {
      const message = updateError.message.includes('already been registered')
        ? 'এই ফোন নম্বরে আগে থেকেই অ্যাকাউন্ট আছে'
        : 'নম্বর বদলাতে সমস্যা হয়েছে: ' + updateError.message;
      return new Response(JSON.stringify({ error: message }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ phone: newPhone })
      .eq('id', callerUser.id);

    if (profileError) {
      return new Response(
        JSON.stringify({ error: 'auth নম্বর বদলেছে কিন্তু প্রোফাইল আপডেট ব্যর্থ: ' + profileError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}