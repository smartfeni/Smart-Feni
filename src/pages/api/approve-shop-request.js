// ============================================================
// API এন্ডপয়েন্ট: শপ আবেদন Approve করা (/api/approve-shop-request)
// শুধু এডমিন প্যানেল থেকে কল হবে (admin/moderator role যাচাই করে)।
// নতুন account তৈরি করে না — shop_requests.user_id এর existing
// account এর উপরেই shops row বসিয়ে দেয়, is_shop_owner=true করে দেয়।
// Service role key শুধু এই সার্ভার ফাইলেই থাকে, ব্রাউজারে যায় না।
//
// আপডেট (shop_order ফিক্স): আগে shops row তৈরির সময় shop_order
// বসানো হতো না, তাই DB ডিফল্ট 0 নিয়েই থাকত — সব শপের shop_order
// সমান হয়ে যাওয়ায় Admin প্যানেলের up/down পজিশন বাটন কাজ করত না।
// এখন insert এর আগে বর্তমান সর্বোচ্চ shop_order বের করে তার +10
// বসানো হচ্ছে, ফলে Approve করা শপও সবসময় লিস্টের শেষে distinct
// order নিয়ে যোগ হবে (create-shop.js এর মতোই)।
//
// আপডেট (একাধিক শপ): আগে approve করলে সবসময় profiles.shop_id নতুন শপে
// ওভাররাইট হতো। এখন is_shop_owner=true সবসময় সেট হয়, কিন্তু profiles.shop_id
// শুধু তখনই বসে যখন ইউজারের আগে কোনো shop_id নেই (অর্থাৎ প্রথম শপ)। দ্বিতীয়
// শপ approve করলে আগের shop_id অক্ষত থাকে। My Shop পেজ shops.owner_id দিয়ে
// সব শপ খোঁজে, তাই দ্বিতীয় শপ ঠিকই দেখা যায়।
//
// আপডেট (স্লাগ — অ্যাডমিন ঠিক করবে): body-তে এখন ঐচ্ছিক `slug` আসে
// ({ requestId, slug? })। অ্যাডমিন approve-এর সময় স্লাগ বক্সে যা দেয় সেটাই বসে।
//  - slug দিলে: slugify + ফরম্যাট চেক → clubs ও shops দুই টেবিলে available কিনা চেক।
//    কনফ্লিক্ট/reserved হলে কিছু তৈরি না করেই 409 + "Not Available" এরর
//    (code: 'slug_unavailable', field: 'slug'); ফরম্যাট ভুল হলে 400 (field: 'slug')।
//    আগের মতো চুপচাপ -2, -3 সাফিক্স বসানো হয় না।
//  - slug না দিলে: আগের auto আচরণ (shop_name থেকে, সাফিক্স সহ) — শুধু API সরাসরি
//    কল হলে কাজে লাগে। বাংলা নামে এখন "-" স্লাগ হয় না, "shop" থেকে শুরু হয়।
// চেক আর insert-এর মাঝে অন্য কেউ একই স্লাগ নিয়ে ফেললে DB-র unique index
// (23505) ধরে একই "Not Available" 409 ফেরত দেওয়া হয়।
// স্লাগের নিয়মকানুন src/lib/slugRules.js-এ।
// ============================================================

import { createClient } from '@supabase/supabase-js';
import {
  slugify,
  validateSlugFormat,
  checkSlugAvailability,
  generateUniqueSlug,
  notAvailableMessage,
} from '../../lib/slugRules.js';

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

    const { requestId, slug: requestedSlug } = await request.json();

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

    // ============================================================
    // স্লাগ ঠিক করা — অ্যাডমিন দিলে সেটা (কনফ্লিক্টে এরর), না দিলে auto
    // শপ তৈরির আগেই সব চেক, যাতে এরর হলে কিছুই তৈরি না হয়
    // ============================================================
    let finalSlug;
    const adminProvidedSlug = typeof requestedSlug === 'string' && requestedSlug.trim() !== '';

    if (adminProvidedSlug) {
      finalSlug = slugify(requestedSlug);

      const formatError = validateSlugFormat(finalSlug);
      if (formatError) {
        return new Response(JSON.stringify({ error: formatError, field: 'slug' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        });
      }

      const availability = await checkSlugAvailability(supabaseAdmin, finalSlug);

      if (availability.reason === 'error') {
        return new Response(JSON.stringify({ error: 'স্লাগ চেক করা যায়নি — আবার চেষ্টা করুন' }), {
          status: 500, headers: { 'Content-Type': 'application/json' },
        });
      }

      if (!availability.available) {
        return new Response(
          JSON.stringify({ error: notAvailableMessage(finalSlug), field: 'slug', code: 'slug_unavailable' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
    } else {
      finalSlug = await generateUniqueSlug(supabaseAdmin, req.shop_name);
    }

    // ============================================================
    // নতুন শপের জন্য পরবর্তী shop_order বের করা — বর্তমান সর্বোচ্চ
    // shop_order এর +10 (ফাঁকা টেবিল হলে 10 থেকে শুরু)
    // ============================================================
    const { data: maxOrderRow } = await supabaseAdmin
      .from('shops')
      .select('shop_order')
      .order('shop_order', { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextShopOrder = (maxOrderRow?.shop_order || 0) + 10;

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
        shop_order: nextShopOrder,
      })
      .select()
      .single();

    if (shopError) {
      // চেকের পরে অন্য কেউ একই স্লাগ নিয়ে ফেললে unique index ধরবে
      if (shopError.code === '23505') {
        return new Response(
          JSON.stringify({ error: notAvailableMessage(finalSlug), field: 'slug', code: 'slug_unavailable' }),
          { status: 409, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(JSON.stringify({ error: 'শপ তৈরি ব্যর্থ: ' + shopError.message }), {
        status: 500, headers: { 'Content-Type': 'application/json' },
      });
    }

    // একাধিক শপ: আগে থেকে shop_id থাকলে সেটা ওভাররাইট করা হয় না
    const { data: ownerProfile } = await supabaseAdmin
      .from('profiles')
      .select('shop_id')
      .eq('id', req.user_id)
      .maybeSingle();

    const profileUpdate = { is_shop_owner: true };
    if (!ownerProfile?.shop_id) {
      profileUpdate.shop_id = shopData.id;
    }

    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update(profileUpdate)
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
