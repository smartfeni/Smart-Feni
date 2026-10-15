// ============================================================
// API এন্ডপয়েন্ট: শপের স্লাগ (URL) পরিবর্তন (/api/update-shop-slug)
// শুধু admin/moderator কল করতে পারবে (admin/shops.astro-র স্লাগ এডিট বাটন)।
//
// body: { shopId, slug }
// flow:
// ১. caller-এর token যাচাই → profiles.role admin/moderator কিনা চেক
// ২. শপ fetch (বর্তমান স্লাগ জানতে)
// ৩. slugify + ফরম্যাট চেক (৪০০, field: 'slug')
// ৪. clubs + shops দুই টেবিলে available কিনা চেক, নিজের শপকে বাদ দিয়ে
//    — কনফ্লিক্ট বা reserved হলে ৪০৯ "Not Available" (code: 'slug_unavailable')
// ৫. shops.slug আপডেট; চেকের পরে অন্য কেউ নিয়ে ফেললে DB unique index (23505) ধরে
//    একই ৪০৯ ফেরত দেয়
//
// ⚠️ স্লাগ বদলালে পুরনো লিংক (smartfeni.com/পুরনো-স্লাগ) আর কাজ করবে না —
// কোনো রিডাইরেক্ট নেই। UI-তে সতর্কবার্তা আছে।
// স্লাগের নিয়মকানুন src/lib/slugRules.js-এ।
// ============================================================

import { createClient } from '@supabase/supabase-js';
// এরর মনিটরিং (ধাপ ৯): ৫০০ পথ ও গিলে-ফেলা এরর অ্যাডমিন এরর লগে রিপোর্ট হয়
import { reportServerError } from '../../lib/serverErrorReporter.js';
import {
  slugify,
  validateSlugFormat,
  checkSlugAvailability,
  notAvailableMessage,
} from '../../lib/slugRules.js';

export const prerender = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  // এরর রিপোর্টের client: service role client তৈরির পর সেট হয়
  let reportDb = null;
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return json({ error: 'অননুমোদিত — লগইন করুন' }, 401);
    }

    const { shopId, slug } = await request.json();

    if (!shopId || typeof slug !== 'string') {
      return json({ error: 'shopId ও slug আবশ্যক' }, 400);
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

    // caller যে টোকেন দিয়ে কল করেছে সেটা সত্যিই admin/moderator এর কিনা যাচাই
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return json({ error: 'অননুমোদিত — সেশন সঠিক না' }, 401);
    }

    const { data: callerProfile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', callerData.user.id)
      .single();

    if (!callerProfile || !['admin', 'moderator'].includes(callerProfile.role)) {
      return json({ error: 'শুধু admin/moderator এই অ্যাকশন নিতে পারবেন' }, 403);
    }

    // শপটা খুঁজে বের করা
    const { data: shop, error: shopFetchError } = await supabaseAdmin
      .from('shops')
      .select('id, name, slug')
      .eq('id', shopId)
      .single();

    if (shopFetchError && shopFetchError.code !== 'PGRST116') {
      await reportServerError(reportDb, {
        route: '/api/update-shop-slug',
        action: 'update_shop_slug_fetch',
        title: 'স্লাগ বদল: শপ পড়া ব্যর্থ',
        message: shopFetchError.message,
        code: shopFetchError.code,
        status: 404,
      });
    }
    if (shopFetchError || !shop) {
      return json({ error: 'শপ খুঁজে পাওয়া যায়নি' }, 404);
    }

    const cleanSlug = slugify(slug);

    const formatError = validateSlugFormat(cleanSlug);
    if (formatError) {
      return json({ error: formatError, field: 'slug' }, 400);
    }

    // একই স্লাগ — কিছু বদলানোর নেই
    if (cleanSlug === shop.slug) {
      return json({ success: true, slug: cleanSlug, changed: false });
    }

    const availability = await checkSlugAvailability(supabaseAdmin, cleanSlug, {
      excludeShopId: shop.id,
    });

    if (availability.reason === 'error') {
      await reportServerError(reportDb, {
        route: '/api/update-shop-slug',
        action: 'update_shop_slug_check',
        title: 'স্লাগ বদল: স্লাগ চেক ব্যর্থ',
        message: 'checkSlugAvailability ব্যর্থ',
        status: 500,
      });
      return json({ error: 'স্লাগ চেক করা যায়নি — আবার চেষ্টা করুন' }, 500);
    }

    if (!availability.available) {
      return json(
        { error: notAvailableMessage(cleanSlug), field: 'slug', code: 'slug_unavailable' },
        409
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from('shops')
      .update({ slug: cleanSlug })
      .eq('id', shop.id);

    if (updateError) {
      if (updateError.code === '23505') {
        return json(
          { error: notAvailableMessage(cleanSlug), field: 'slug', code: 'slug_unavailable' },
          409
        );
      }
      await reportServerError(reportDb, {
        route: '/api/update-shop-slug',
        action: 'update_shop_slug_update',
        title: 'স্লাগ আপডেট (shops update) ব্যর্থ',
        message: updateError.message,
        code: updateError.code,
        status: 500,
      });
      return json({ error: 'স্লাগ আপডেট ব্যর্থ: ' + updateError.message }, 500);
    }

    return json({ success: true, slug: cleanSlug, oldSlug: shop.slug, changed: true });
  } catch (err) {
    await reportServerError(reportDb, {
      route: '/api/update-shop-slug',
      action: 'update_shop_slug_unexpected',
      title: 'স্লাগ বদল: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return json({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }, 500);
  }
}
