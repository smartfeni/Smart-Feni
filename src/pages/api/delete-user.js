// ============================================================
// API এন্ডপয়েন্ট: ইউজার পার্মানেন্ট ডিলিট (/api/delete-user)
// শুধু admin role কল করতে পারবে (moderator না — এটা irreversible)।
// caller-এর identity সার্ভার-সাইডে ভেরিফাই করা হয় (access token দিয়ে),
// শুধু ক্লায়েন্ট-সাইড গার্ডের উপর ভরসা করা হয় না।
//
// flow:
// ১. caller-এর token যাচাই → profiles.role === 'admin' কিনা চেক
// ২. নিজেকে বা অন্য admin/moderator কে ডিলিট করা ব্লক (সেফটি)
// ৩. টার্গেট ইউজারের সব লিস্টিং থেকে owner সরানো (user_id → null,
//    লিস্টিং নিজে থেকে যাবে, শুধু owner তথ্য থাকবে না)
// ৪. auth.admin.deleteUser() — ধরে নেওয়া হচ্ছে profiles টেবিলে
//    id column-এ auth.users(id) references ON DELETE CASCADE আছে
//    (স্ট্যান্ডার্ড Supabase প্যাটার্ন), তাই profile row অটো ডিলিট হবে।
//    যদি cascade সেটআপ না থাকে, এই কল এরর দিবে — তখন Supabase এ
//    profiles.id FK constraint চেক করে ON DELETE CASCADE বসাতে হবে।
//
// আপডেট (এরর মনিটরিং, ধাপ ৭): ৫০০ এরর (লিস্টিং থেকে owner সরানো ফেইল,
// auth.admin.deleteUser ফেইল, অপ্রত্যাশিত ত্রুটি) serverErrorReporter.js দিয়ে
// অ্যাডমিন এরর লগে (/admin/errors) যায়। ৪০০/৪০১/৪০৩ (স্বাভাবিক গার্ড) রিপোর্ট হয় না।
// রেসপন্স/মেসেজ/স্ট্যাটাস কোড অপরিবর্তিত।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { reportServerError } from '../../lib/serverErrorReporter.js';

export const prerender = false;

export async function POST({ request }) {
  // এরর রিপোর্টের জন্য সার্ভিস-রোল ক্লায়েন্ট (catch ব্লকেও লাগে, তাই try-র বাইরে)
  let reportClient = null;

  try {
    const { targetUserId, accessToken } = await request.json();

    if (!targetUserId || !accessToken) {
      return new Response(
        JSON.stringify({ error: 'targetUserId ও accessToken আবশ্যক' }),
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

    // caller-এর token দিয়ে তার identity যাচাই (anon key + token দিয়ে)
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

    // এডমিন ক্লায়েন্ট — সার্ভিস রোল কী দিয়ে, শুধু এই সার্ভার ফাইলেই থাকে
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    reportClient = supabaseAdmin;

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (callerProfileError || callerProfile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'শুধু অ্যাডমিন ইউজার পার্মানেন্ট ডিলিট করতে পারবেন' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (targetUserId === callerUser.id) {
      return new Response(
        JSON.stringify({ error: 'নিজেকে ডিলিট করা যাবে না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: targetProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', targetUserId)
      .single();

    if (targetProfile?.role === 'admin' || targetProfile?.role === 'moderator') {
      return new Response(
        JSON.stringify({ error: 'অন্য অ্যাডমিন/মডারেটর ডিলিট করা যাবে না' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // টার্গেটের সব লিস্টিং থেকে owner সরানো — লিস্টিং নিজে থেকে যাবে
    const { error: detachError } = await supabaseAdmin
      .from('listings')
      .update({ user_id: null })
      .eq('user_id', targetUserId);

    if (detachError) {
      await reportServerError(reportClient, {
        route: '/api/delete-user',
        action: 'delete_user_detach',
        title: 'ইউজার ডিলিট: লিস্টিং থেকে owner সরানো ব্যর্থ',
        message: detachError.message,
        code: detachError.code,
        status: 500,
      });
      return new Response(
        JSON.stringify({ error: 'লিস্টিং থেকে owner সরাতে সমস্যা হয়েছে: ' + detachError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(targetUserId);

    if (deleteError) {
      // লিস্টিং থেকে owner আগেই সরে গেছে কিন্তু ইউজার রয়ে গেছে — অ্যাডমিনকে জানানো দরকার
      await reportServerError(reportClient, {
        route: '/api/delete-user',
        action: 'delete_user_auth_delete',
        title: 'ইউজার ডিলিট ব্যর্থ (লিস্টিং আগেই owner-হীন)',
        message: 'লিস্টিং আগেই owner-হীন হয়েছে; ' + deleteError.message,
        code: deleteError.code || deleteError.status,
        status: 500,
      });
      return new Response(
        JSON.stringify({ error: 'ইউজার ডিলিট ব্যর্থ: ' + deleteError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    await reportServerError(reportClient, {
      route: '/api/delete-user',
      action: 'delete_user_unexpected',
      title: 'ইউজার ডিলিট: অপ্রত্যাশিত ত্রুটি',
      message: err?.message,
      status: 500,
    });
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}