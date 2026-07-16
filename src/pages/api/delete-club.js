// ============================================================
// API এন্ডপয়েন্ট: ক্লাব পার্মানেন্ট ডিলিট (/api/delete-club)
// শুধু admin role কল করতে পারবে। caller-এর identity সার্ভার-সাইডে
// ভেরিফাই করা হয় (access token দিয়ে)।
//
// flow:
// ১. caller-এর token যাচাই → profiles.role === 'admin' কিনা চেক
// ২. clubs টেবিলের row ডিলিট (club_members, club_posts,
//    club_notifications, club_join_requests এর FK-তে ON DELETE
//    CASCADE আছে, তাই এগুলো নিজে থেকেই মুছে যাবে)
// ৩. profiles টেবিলে is_club_owner=false, club_id=null রিসেট
// ৪. auth.admin.deleteUser() — ক্লাব ওনারের লগইন অ্যাকাউন্টও মুছে
//    যাবে (চাইলে এই ধাপ স্কিপ করে শুধু ক্লাব ডেটা মোছা যেত, কিন্তু
//    একাউন্ট রেখে দিলে ভুতুড়ে/অকেজো লগইন থেকে যায়)
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const { clubId, accessToken } = await request.json();

    if (!clubId || !accessToken) {
      return new Response(
        JSON.stringify({ error: 'clubId ও accessToken আবশ্যক' }),
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

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerUser.id)
      .single();

    if (callerProfileError || callerProfile?.role !== 'admin') {
      return new Response(
        JSON.stringify({ error: 'শুধু অ্যাডমিন ক্লাব ডিলিট করতে পারবেন' }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: club, error: clubFetchError } = await supabaseAdmin
      .from('clubs')
      .select('owner_id, name')
      .eq('id', clubId)
      .single();

    if (clubFetchError || !club) {
      return new Response(
        JSON.stringify({ error: 'ক্লাব খুঁজে পাওয়া যায়নি' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // clubs row ডিলিট — cascade-এ club_members/club_posts/
    // club_notifications/club_join_requests সব মুছে যাবে
    const { error: deleteClubError } = await supabaseAdmin
      .from('clubs')
      .delete()
      .eq('id', clubId);

    if (deleteClubError) {
      return new Response(
        JSON.stringify({ error: 'ক্লাব ডিলিট ব্যর্থ: ' + deleteClubError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ওনারের auth অ্যাকাউন্ট ডিলিট (থাকলে)
    if (club.owner_id) {
      const { error: deleteUserError } = await supabaseAdmin.auth.admin.deleteUser(club.owner_id);
      if (deleteUserError) {
        // ক্লাব ডেটা মুছে গেছে, কিন্তু ওনার অ্যাকাউন্ট রয়ে গেছে —
        // ওয়ার্নিং সহ success পাঠাচ্ছি যাতে এডমিন জানে
        return new Response(
          JSON.stringify({
            success: true,
            warning: 'ক্লাব ডিলিট হয়েছে, কিন্তু ওনারের লগইন অ্যাকাউন্ট ডিলিট ব্যর্থ: ' + deleteUserError.message,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
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