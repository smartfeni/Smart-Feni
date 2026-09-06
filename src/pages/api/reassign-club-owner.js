// ============================================================
// API এন্ডপয়েন্ট: ক্লাবের ওউনার পরিবর্তন (/api/reassign-club-owner)
// শুধু admin/moderator কল করতে পারবে। কোনো ক্লাবকে অন্য existing
// (আগে থেকে অ্যাকাউন্ট আছে এমন) ইউজারের সাথে রিলিংক করে —
// নতুন অ্যাকাউন্ট বানায় না, পুরনোটাও ডিলিট করে না।
// (reassign-shop-owner.js এর হুবহু একই প্যাটার্ন, শুধু clubs টেবিল
// আর is_club_owner/club_id ফিল্ড ব্যবহার করে।)
//
// flow:
// ১. caller-এর token যাচাই → profiles.role admin/moderator কিনা চেক
// ২. clubs row fetch (আগের owner_id বের করা)
// ৩. নতুন owner-কে ফোন নম্বর দিয়ে profiles এ খোঁজা
// ৪. নতুন owner যদি আগে থেকেই অন্য ক্লাবের মালিক হয়, তাহলে আটকানো
//    (এক অ্যাকাউন্ট = এক ক্লাব — কনফ্লিক্ট এড়াতে)
// ৫. clubs.owner_id নতুন user_id তে বদলানো
// ৬. পুরনো ওউনারের profiles রিসেট (is_club_owner=false, club_id=null)
// ৭. নতুন ওউনারের profiles সেট (is_club_owner=true, club_id=clubId)
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

export async function POST({ request }) {
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return new Response(JSON.stringify({ error: 'অননুমোদিত — লগইন করুন' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { clubId, newOwnerPhone } = await request.json();

    if (!clubId || !newOwnerPhone) {
      return new Response(JSON.stringify({ error: 'clubId ও newOwnerPhone আবশ্যক' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return new Response(
        JSON.stringify({ error: 'সার্ভার কনফিগারেশন ঠিক নেই (service role key পাওয়া যায়নি)' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // caller যে টোকেন দিয়ে কল করেছে সেটা সত্যিই admin/moderator এর কিনা যাচাই
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return new Response(JSON.stringify({ error: 'অননুমোদিত — সেশন সঠিক না' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .single();

    if (!callerProfile || !['admin', 'moderator'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: 'শুধু admin/moderator এই অ্যাকশন নিতে পারবেন' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    // ক্লাবটা খুঁজে বের করা (পুরনো owner_id দরকার রিসেট করার জন্য)
    const { data: club, error: clubFetchError } = await supabaseAdmin
      .from('clubs')
      .select('id, name, owner_id')
      .eq('id', clubId)
      .single();

    if (clubFetchError || !club) {
      return new Response(JSON.stringify({ error: 'ক্লাব খুঁজে পাওয়া যায়নি' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    // নতুন ওউনারকে ফোন নম্বর দিয়ে profiles এ খোঁজা
    const digitsOnly = newOwnerPhone.replace(/\D/g, '');
    const { data: newOwnerProfile, error: newOwnerError } = await supabaseAdmin
      .from('profiles')
      .select('id, club_id, phone')
      .eq('phone', digitsOnly)
      .maybeSingle();

    if (newOwnerError || !newOwnerProfile) {
      return new Response(
        JSON.stringify({ error: 'এই ফোন নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি — নতুন ওউনারকে আগে সাইটে অ্যাকাউন্ট খুলতে হবে' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // নতুন ওউনার যদি আগে থেকেই অন্য কোনো ক্লাবের মালিক হয়, আটকানো
    if (newOwnerProfile.club_id && newOwnerProfile.club_id !== clubId) {
      return new Response(
        JSON.stringify({ error: 'এই অ্যাকাউন্ট ইতিমধ্যে অন্য একটা ক্লাবের মালিক — একটা অ্যাকাউন্ট দিয়ে একটাই ক্লাব চালানো যায়' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ক্লাবের owner_id বদলানো
    const { error: updateClubError } = await supabaseAdmin
      .from('clubs')
      .update({ owner_id: newOwnerProfile.id })
      .eq('id', clubId);

    if (updateClubError) {
      return new Response(
        JSON.stringify({ error: 'ক্লাব আপডেট ব্যর্থ: ' + updateClubError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // পুরনো ওউনার রিসেট (থাকলে, আর যদি নতুন-পুরনো একই না হয়)
    if (club.owner_id && club.owner_id !== newOwnerProfile.id) {
      await supabaseAdmin
        .from('profiles')
        .update({ is_club_owner: false, club_id: null })
        .eq('id', club.owner_id);
    }

    // নতুন ওউনার সেট
    const { error: newOwnerUpdateError } = await supabaseAdmin
      .from('profiles')
      .update({ is_club_owner: true, club_id: clubId })
      .eq('id', newOwnerProfile.id);

    if (newOwnerUpdateError) {
      return new Response(
        JSON.stringify({ error: 'ক্লাব আপডেট হয়েছে কিন্তু নতুন ওউনারের প্রোফাইল আপডেট ব্যর্থ: ' + newOwnerUpdateError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, clubName: club.name, newOwnerId: newOwnerProfile.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
