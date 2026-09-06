// ============================================================
// API এন্ডপয়েন্ট: ক্লাব পার্মানেন্ট ডিলিট (/api/delete-club)
// শুধু admin role কল করতে পারবে। caller-এর identity সার্ভার-সাইডে
// ভেরিফাই করা হয় (access token দিয়ে)।
//
// flow:
// ১. caller-এর token যাচাই → profiles.role === 'admin' কিনা চেক
// ২. এই ক্লাবের সব moderators রো ডিলিট (entity_type='club')
// ৩. ওউনারের profiles রিসেট (is_club_owner=false, club_id=null) —
//    clubs রো ডিলিটের আগেই, কারণ profiles.club_id ফরেন-কি clubs.id
//    কে রেফারেন্স করে (ON DELETE NO ACTION)
// ৪. clubs টেবিলের row ডিলিট (club_members, club_posts,
//    club_notifications, club_join_requests এর FK-তে ON DELETE
//    CASCADE আছে, তাই এগুলো নিজে থেকেই মুছে যাবে; manual_blood_donors
//    এর club_id SET NULL হয়ে যাবে)
//
// আপডেট (FK ফিক্স + বিহেভিয়ার পরিবর্তন): আগে এই ফাইলে ধাপ উল্টো
// ছিল — আগে clubs রো ডিলিট, পরে ওউনারের auth অ্যাকাউন্ট
// (auth.admin.deleteUser) সম্পূর্ণ ডিলিট করে দেওয়া হতো। এতে দুইটা
// সমস্যা ছিল: (ক) profiles.club_id ফরেন-কি এর কারণে clubs ডিলিট
// সবসময় ফেইল করত ("violates foreign key constraint" এরর), (খ)
// ওউনারের লগইন অ্যাকাউন্ট পুরোপুরি মুছে যেত। এখন থেকে —
// shop ডিলিটের মতোই — শুধু ক্লাব-সংক্রান্ত ডেটা মুছবে, ওউনারের
// প্রোফাইল/অ্যাকাউন্ট শুধু রিসেট হবে (is_club_owner=false,
// club_id=null), ডিলিট হবে না।
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

    // ১. এই ক্লাবের সব মডারেটর রো ডিলিট
    await supabaseAdmin
      .from('moderators')
      .delete()
      .eq('entity_type', 'club')
      .eq('entity_id', clubId);

    // ২. ওউনারের প্রোফাইল রিসেট — clubs রো ডিলিটের আগেই করতে হবে,
    // কারণ profiles.club_id ফরেন-কি clubs.id কে রেফারেন্স করে
    // (অ্যাকাউন্ট ডিলিট হয় না, শুধু ফ্ল্যাগ রিসেট)
    if (club.owner_id) {
      await supabaseAdmin
        .from('profiles')
        .update({ is_club_owner: false, club_id: null })
        .eq('id', club.owner_id);
    }

    // ৩. clubs row ডিলিট — cascade-এ club_members/club_posts/
    // club_notifications/club_join_requests সব মুছে যাবে,
    // manual_blood_donors.club_id SET NULL হয়ে যাবে
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
