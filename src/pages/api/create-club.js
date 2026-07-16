// ============================================================
// API এন্ডপয়েন্ট: নতুন ক্লাব ওউনার অ্যাকাউন্ট তৈরি (/api/create-club)
// শুধু এডমিন প্যানেল থেকে কল হবে। Service role key ব্যবহার করে
// Supabase Auth এ ইউজার তৈরি করে, clubs টেবিলে row বসায়,
// তারপর profiles এ is_club_owner ও club_id সেট করে দেয়।
// এই key কখনো ব্রাউজারে পাঠানো হয় না — শুধু এই সার্ভার ফাইলেই থাকে।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

// এই স্লাগগুলো ক্লাবের জন্য ব্যবহার করা যাবে না — সাইটের
// এক্সিস্টিং রুটের সাথে কনফ্লিক্ট করবে
const RESERVED_SLUGS = [
  'housing', 'job', 'repair', 'car-rental', 'courier', 'emergency',
  'blood', 'home-food', 'recycle', 'tuition', 'sports', 'lost-found',
  'health', 'legal', 'event', 'laundry', 'doctor-directory', 'online-shop',
  'clubs', 'admin', 'api', 'my-club', 'my-shop', 'services', 'profile',
  'shop', 'about', 'contact', 'index',
];

function slugify(input) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

export async function POST({ request }) {
  try {
    const { clubName, slug, phone, password, upajila } = await request.json();

    if (!clubName || !slug || !phone || !password) {
      return new Response(
        JSON.stringify({ error: 'ক্লাবের নাম, স্লাগ, ফোন নম্বর ও পাসওয়ার্ড আবশ্যক' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const cleanSlug = slugify(slug);

    if (!cleanSlug) {
      return new Response(
        JSON.stringify({ error: 'স্লাগ সঠিক ফরম্যাটে দিন (শুধু ইংরেজি অক্ষর/সংখ্যা/হাইফেন)' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    if (RESERVED_SLUGS.includes(cleanSlug)) {
      return new Response(
        JSON.stringify({ error: `"${cleanSlug}" স্লাগটি সংরক্ষিত, অন্য একটা নাম দিন` }),
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

    // স্লাগ আগে থেকে ব্যবহৃত কিনা চেক
    const { data: existingClub } = await supabaseAdmin
      .from('clubs')
      .select('id')
      .eq('slug', cleanSlug)
      .maybeSingle();

    if (existingClub) {
      return new Response(
        JSON.stringify({ error: `"${cleanSlug}" স্লাগটি ইতিমধ্যে অন্য ক্লাব ব্যবহার করছে` }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const digitsOnly = phone.replace(/\D/g, '');
    const email = `${digitsOnly}@smartfeni.local`;

    // ধাপ ১: Auth ইউজার তৈরি
    const { data: userData, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: clubName, phone },
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

    // ধাপ ২: clubs টেবিলে row তৈরি
    const { data: clubData, error: clubError } = await supabaseAdmin
      .from('clubs')
      .insert({
        owner_id: userData.user.id,
        name: clubName,
        slug: cleanSlug,
        upajila: upajila || null,
        is_active: true,
        is_verified: false,
      })
      .select()
      .single();

    if (clubError) {
      // clubs row তৈরি ব্যর্থ হলে তৈরি হওয়া auth ইউজার ক্লিনআপ করে দেওয়া ভালো
      await supabaseAdmin.auth.admin.deleteUser(userData.user.id);
      return new Response(
        JSON.stringify({ error: 'ক্লাব তৈরি ব্যর্থ: ' + clubError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // ধাপ ৩: profiles আপডেট
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({
        is_club_owner: true,
        club_id: clubData.id,
      })
      .eq('id', userData.user.id);

    if (profileError) {
      return new Response(
        JSON.stringify({ error: 'ক্লাব তৈরি হয়েছে কিন্তু প্রোফাইল আপডেট ব্যর্থ: ' + profileError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        userId: userData.user.id,
        clubId: clubData.id,
        clubName,
        slug: cleanSlug,
        phone,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}