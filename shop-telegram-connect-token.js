// ============================================================
// API এন্ডপয়েন্ট: শপ Telegram bot কানেক্ট করার জন্য এক-বার-ব্যবহারযোগ্য
// সিক্রেট টোকেন জেনারেট করা (/api/shop-telegram-connect-token)
//
// কেন লাগলো (সিকিউরিটি ফিক্স — Option B):
// আগে t.me/SmartFeniShopBoT?start={shopId} লিংকে শপের UUID সরাসরি
// পাঠানো হতো। কিন্তু শপের UUID অনেক জায়গায় client-side HTML-এ
// এক্সপোজড থাকে (public shop page ইত্যাদি) — তাই যে কেউ সেই UUID
// দিয়ে নিজের Telegram অ্যাকাউন্ট বট-এ কানেক্ট করে অন্যের শপের
// অর্ডার নোটিফিকেশন হাইজ্যাক করতে পারত।
//
// এখন: শুধু সেই শপের প্রকৃত ওউনার (বা admin/moderator) লগইন করা
// অবস্থায় এই এন্ডপয়েন্ট কল করলেই একটা random, one-time secret
// token জেনারেট হয় (shops.telegram_connect_token কলামে সেভ হয়),
// আর সেই token-ই /start পেলোড হিসেবে পাঠানো হয়। webhook token
// দিয়ে শপ খুঁজে, connect হয়ে গেলে token সাথে সাথে null করে দেয়
// (একবারই ব্যবহারযোগ্য)।
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

    const { shopId } = await request.json();

    if (!shopId) {
      return new Response(JSON.stringify({ error: 'shopId আবশ্যক' }), {
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

    // caller-এর টোকেন যাচাই
    const { data: callerData, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerData?.user) {
      return new Response(JSON.stringify({ error: 'অননুমোদিত — সেশন সঠিক না' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }

    // শপটা খুঁজে বের করা
    const { data: shop, error: shopFetchError } = await supabaseAdmin
      .from('shops')
      .select('id, owner_id')
      .eq('id', shopId)
      .maybeSingle();

    if (shopFetchError || !shop) {
      return new Response(JSON.stringify({ error: 'শপ খুঁজে পাওয়া যায়নি' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    // caller নিজেই এই শপের ওউনার কিনা, নাহলে admin/moderator কিনা চেক
    let authorized = shop.owner_id === callerData.user.id;

    if (!authorized) {
      const { data: callerProfile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', callerData.user.id)
        .single();
      authorized = !!callerProfile && ['admin', 'moderator'].includes(callerProfile.role);
    }

    if (!authorized) {
      return new Response(JSON.stringify({ error: 'শুধু শপের ওউনার বা admin/moderator এই কাজ করতে পারবেন' }), {
        status: 403, headers: { 'Content-Type': 'application/json' },
      });
    }

    // random one-time secret token জেনারেট করা
    const connectToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');

    const { error: updateError } = await supabaseAdmin
      .from('shops')
      .update({ telegram_connect_token: connectToken })
      .eq('id', shopId);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'টোকেন সেভ করতে ব্যর্থ: ' + updateError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, token: connectToken }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}