// ============================================================
// API এন্ডপয়েন্ট: স্লাগ available কিনা চেক (/api/check-shop-slug)
// শুধু admin/moderator কল করতে পারবে (admin/shops.astro-র লাইভ চেকের জন্য)।
// কিছু বদলায় না — শুধু পড়ে।
//
// body: { slug, excludeShopId? }
//   excludeShopId: স্লাগ এডিটের সময় নিজের শপকে বাদ দেওয়ার জন্য
// রেসপন্স (সবসময় 200, available না হলেও — এটা এরর না, চেকের ফল):
//   { available: true,  slug: "cleaned-slug" }
//   { available: false, slug: "cleaned-slug", error: "Not Available — ..." }
// 401/403 অথবা 400 (slug ফিল্ডই নেই) আর 500 (ডাটাবেস ত্রুটি) ছাড়া এরর স্ট্যাটাস নেই।
// ============================================================

import { createClient } from '@supabase/supabase-js';
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
  try {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      return json({ error: 'অননুমোদিত — লগইন করুন' }, 401);
    }

    const { slug, excludeShopId } = await request.json();

    if (typeof slug !== 'string') {
      return json({ error: 'slug আবশ্যক' }, 400);
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই (service role key পাওয়া যায়নি)' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

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

    const cleanSlug = slugify(slug);

    const formatError = validateSlugFormat(cleanSlug);
    if (formatError) {
      return json({ available: false, slug: cleanSlug, error: formatError });
    }

    const result = await checkSlugAvailability(supabaseAdmin, cleanSlug, {
      excludeShopId: typeof excludeShopId === 'string' ? excludeShopId : undefined,
    });

    if (result.reason === 'error') {
      return json({ error: 'স্লাগ চেক করা যায়নি — আবার চেষ্টা করুন' }, 500);
    }

    if (!result.available) {
      return json({ available: false, slug: cleanSlug, error: notAvailableMessage(cleanSlug) });
    }

    return json({ available: true, slug: cleanSlug });
  } catch (err) {
    return json({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }, 500);
  }
}