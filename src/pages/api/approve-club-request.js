// ============================================================
// API এন্ডপয়েন্ট: ক্লাব আবেদন Approve করা (/api/approve-club-request)
// শুধু এডমিন প্যানেল থেকে কল হবে (clubs.manage পারমিশন যাচাই করে)।
// approve-shop-request.js-এর একই প্যাটার্ন: নতুন account তৈরি করে না —
// club_requests.user_id-র existing account-এর উপরেই clubs row বসিয়ে দেয়,
// is_club_owner=true করে দেয়। Service role key শুধু এই সার্ভার ফাইলেই থাকে।
//
// স্লাগ: ক্লাবের ক্ষেত্রে অ্যাডমিনকে স্লাগ দিতেই হবে (body-তে `slug`)।
//  - slugify + ফরম্যাট চেক → clubs ও shops দুই টেবিলে available কিনা চেক।
//    কনফ্লিক্ট/reserved হলে কিছু তৈরি না করেই 409 + "Not Available" এরর
//    (code: 'slug_unavailable', field: 'slug'); ফরম্যাট ভুল হলে 400 (field: 'slug')।
//  - চেক আর insert-এর মাঝে অন্য কেউ একই স্লাগ নিলে unique index (23505) ধরে
//    একই "Not Available" 409 ফেরত দেওয়া হয়।
//
// একাধিক ক্লাব: profiles.is_club_owner সবসময় true হয়, কিন্তু profiles.club_id
// শুধু তখনই বসে যখন ইউজারের আগে কোনো club_id নেই (দ্বিতীয় ক্লাবে আগেরটা অক্ষত)।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { callerCan } from '../../lib/serverPermission.js';
import { reportServerError } from '../../lib/serverErrorReporter.js';
import {
  slugify,
  validateSlugFormat,
  checkSlugAvailability,
  notAvailableMessage,
} from '../../lib/slugRules.js';

export const prerender = false;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  let reportDb = null;
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return json({ error: 'অননুমোদিত — লগইন করুন' }, 401);
    }

    const { requestId, slug: requestedSlug } = await request.json();

    if (!requestId) {
      return json({ error: 'requestId আবশ্যক' }, 400);
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই (service role key পাওয়া যায়নি)' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    reportDb = supabaseAdmin;

    // যে টোকেন দিয়ে কল হয়েছে, সেটা সত্যিই clubs.manage পারমিশনের কিনা যাচাই
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return json({ error: 'অননুমোদিত — সেশন সঠিক না' }, 401);
    }

    if (!(await callerCan(supabaseAdmin, callerData.user.id, 'clubs.manage'))) {
      return json({ error: 'শুধু admin/moderator এই অ্যাকশন নিতে পারবেন' }, 403);
    }

    // আবেদনটা লোড করা
    const { data: req, error: reqError } = await supabaseAdmin
      .from('club_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (reqError) {
      await reportServerError(reportDb, {
        route: '/api/approve-club-request',
        action: 'approve_club_fetch',
        title: 'ক্লাব আবেদন Approve: আবেদন পড়া ব্যর্থ',
        message: reqError.message,
        code: reqError.code,
        status: 500,
      });
    }
    if (reqError || !req) {
      return json({ error: 'আবেদন পাওয়া যায়নি' }, 404);
    }

    if (req.status !== 'pending') {
      return json({ error: 'এই আবেদনটি ইতিমধ্যে প্রক্রিয়া করা হয়েছে' }, 400);
    }

    // ===== স্লাগ — অ্যাডমিনকে দিতেই হবে, কিছু তৈরির আগেই সব চেক =====
    if (typeof requestedSlug !== 'string' || requestedSlug.trim() === '') {
      return json({ error: 'স্লাগ (লিংক) দিন', field: 'slug' }, 400);
    }

    const finalSlug = slugify(requestedSlug);

    const formatError = validateSlugFormat(finalSlug);
    if (formatError) {
      return json({ error: formatError, field: 'slug' }, 400);
    }

    const availability = await checkSlugAvailability(supabaseAdmin, finalSlug);

    if (availability.reason === 'error') {
      await reportServerError(reportDb, {
        route: '/api/approve-club-request',
        action: 'approve_club_slug_check',
        title: 'ক্লাব আবেদন Approve: স্লাগ চেক ব্যর্থ',
        message: 'checkSlugAvailability ব্যর্থ',
        status: 500,
      });
      return json({ error: 'স্লাগ চেক করা যায়নি — আবার চেষ্টা করুন' }, 500);
    }

    if (!availability.available) {
      return json({ error: notAvailableMessage(finalSlug), field: 'slug', code: 'slug_unavailable' }, 409);
    }

    // clubs row তৈরি (existing user_id এর উপর, নতুন account না বানিয়ে)
    const { data: clubData, error: clubError } = await supabaseAdmin
      .from('clubs')
      .insert({
        owner_id: req.user_id,
        name: req.club_name,
        slug: finalSlug,
        phone: req.phone,
        upajila: req.upajila || null,
        is_active: true,
        is_verified: false,
      })
      .select()
      .single();

    if (clubError) {
      if (clubError.code === '23505') {
        return json({ error: notAvailableMessage(finalSlug), field: 'slug', code: 'slug_unavailable' }, 409);
      }
      await reportServerError(reportDb, {
        route: '/api/approve-club-request',
        action: 'approve_club_insert',
        title: 'ক্লাব আবেদন Approve: ক্লাব তৈরি (insert) ব্যর্থ',
        message: clubError.message,
        code: clubError.code,
        status: 500,
      });
      return json({ error: 'ক্লাব তৈরি ব্যর্থ: ' + clubError.message }, 500);
    }

    // একাধিক ক্লাব: আগে থেকে club_id থাকলে সেটা ওভাররাইট করা হয় না
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('club_id')
      .eq('id', req.user_id)
      .maybeSingle();

    const profileUpdate = { is_club_owner: true };
    if (!ownerProfile?.club_id) {
      profileUpdate.club_id = clubData.id;
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdate)
      .eq('id', req.user_id);

    if (profileError) {
      await reportServerError(reportDb, {
        route: '/api/approve-club-request',
        action: 'approve_club_profile',
        title: 'ক্লাব আবেদন Approve: ক্লাব হয়েছে কিন্তু প্রোফাইল আপডেট ব্যর্থ',
        message: profileError.message,
        code: profileError.code,
        status: 500,
      });
      return json({ error: 'ক্লাব তৈরি হয়েছে কিন্তু প্রোফাইল আপডেট ব্যর্থ: ' + profileError.message }, 500);
    }

    const { error: reqStatusError } = await supabaseAdmin
      .from('club_requests')
      .update({ status: 'accepted' })
      .eq('id', requestId);

    if (reqStatusError) {
      await reportServerError(reportDb, {
        route: '/api/approve-club-request',
        action: 'approve_club_request_status',
        title: 'ক্লাব আবেদন Approve: আবেদনের স্ট্যাটাস accepted করা ব্যর্থ',
        message: reqStatusError.message,
        code: reqStatusError.code,
        status: 200,
      });
    }

    return json({ success: true, clubId: clubData.id, slug: finalSlug }, 200);
  } catch (err) {
    await reportServerError(reportDb, {
      route: '/api/approve-club-request',
      action: 'approve_club_unexpected',
      title: 'ক্লাব আবেদন Approve: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return json({ error: 'অপ্রত্যাশিত ত্রুটি: ' + (err && err.message) }, 500);
  }
}
