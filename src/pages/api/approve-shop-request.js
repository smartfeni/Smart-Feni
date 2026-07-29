// ============================================================
// API এন্ডপয়েন্ট: শপ আবেদন Approve করা (/api/approve-shop-request)
// শুধু এডমিন প্যানেল থেকে কল হবে (admin/moderator role যাচাই করে)।
// নতুন account তৈরি করে না — shop_requests.user_id এর existing
// account এর উপরেই shops row বসিয়ে দেয়, is_shop_owner=true করে দেয়।
// Slug shop_name থেকে auto-generate হয় (clubs+shops দুটোতেই
// uniqueness চেক করে, কনফ্লিক্ট হলে -2, -3 ইত্যাদি সাফিক্স যোগ হয়)।
// Service role key শুধু এই সার্ভার ফাইলেই থাকে, ব্রাউজারে যায় না।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

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
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return new Response(JSON.stringify({ error: 'অননুমোদিত — লগইন করুন' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { requestId } = await request.json();

    if (!requestId) {
      return new Response(JSON.stringify({ error: 'requestId আবশ্যক' }), {
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

    // যে টোকেন দিয়ে কল হয়েছে, সেটা সত্যিই admin/moderator এর কিনা যাচাই
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

    // আবেদনটা লোড করা
    const { data: req, error: reqError } = await supabaseAdmin
      .from('shop_requests')
      .select('*')
      .eq('id', requestId)
      .single();

    if (reqError || !req) {
      return new Response(JSON.stringify({ error: 'আবেদন পাওয়া যায়নি' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    if (req.status !== 'pending') {
      return new Response(JSON.stringify({ error: 'এই আবেদনটি ইতিমধ্যে প্রক্রিয়া করা হয়েছে' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      });
    }

    // ইউনিক স্লাগ জেনারেট (clubs + shops দুটোতেই চেক করে, কনফ্লিক্ট হলে সাফিক্স)
    const baseSlug = slugify(req.shop_name) || 'shop';
    let finalSlug = baseSlug;
    let suffix = 2;

    while (true) {
      if (RESERVED_SLUGS.includes(finalSlug)) {
        finalSlug = `${baseSlug}-${suffix}`;
        suffix++;
        continue;
      }
      const [{ data: clubHit }, { data: shopHit }] = await Promise.all([
        supabaseAdmin.from('clubs').select('id').eq('slug', finalSlug).maybeSingle(),
        supabaseAdmin.from('shops').select('id').eq('slug', finalSlug).maybeSingle(),
      ]);
      if (!clubHit && !shopHit) break;
      finalSlug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    // shops row তৈরি (existing user_id এর উপর, নতুন account না বানিয়ে)
    const { data: shopData, error: shopError } = await supabaseAdmin
      .from('shops')
      .insert({
        owner_id: req.user_id,
        name: req.shop_name,
        slug: finalSlug,
        phone: req.phone,
        is_active: true,
        is_verified: false,
      })
      .select()
      .single();

    if (shopError) {
      return new Response(JSON.stringify({ error: 'শপ তৈরি ব্যর্থ: ' + shopError.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ is_shop_owner: true, shop_id: shopData.id })
      .eq('id', req.user_id);

    if (profileError) {
      return new Response(
        JSON.stringify({ error: 'শপ তৈরি হয়েছে কিন্তু প্রোফাইল আপডেট ব্যর্থ: ' + profileError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    await supabaseAdmin.from('shop_requests').update({ status: 'accepted' }).eq('id', requestId);

    return new Response(
      JSON.stringify({ success: true, shopId: shopData.id, slug: finalSlug }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}