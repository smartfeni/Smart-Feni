// ============================================================
// API এন্ডপয়েন্ট: শপের ওউনার পরিবর্তন (/api/reassign-shop-owner)
// শুধু admin/moderator কল করতে পারবে। কোনো শপকে অন্য existing
// (আগে থেকে অ্যাকাউন্ট আছে এমন) ইউজারের সাথে রিলিংক করে —
// নতুন অ্যাকাউন্ট বানায় না, পুরনোটাও ডিলিট করে না।
//
// flow:
// ১. caller-এর token যাচাই → profiles.role admin/moderator কিনা চেক
// ২. shops row fetch (আগের owner_id বের করা)
// ৩. নতুন owner-কে ফোন নম্বর দিয়ে profiles এ খোঁজা
// ৪. নতুন owner যদি আগে থেকেই অন্য শপের মালিক হয়, তাহলে আটকানো
//    (এক অ্যাকাউন্ট = এক শপ — কনফ্লিক্ট এড়াতে)
// ৫. shops.owner_id নতুন user_id তে বদলানো
// ৬. পুরনো ওউনারের profiles রিসেট (is_shop_owner=false, shop_id=null)
// ৭. নতুন ওউনারের profiles সেট (is_shop_owner=true, shop_id=shopId)
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

    const { shopId, newOwnerPhone } = await request.json();

    if (!shopId || !newOwnerPhone) {
      return new Response(JSON.stringify({ error: 'shopId ও newOwnerPhone আবশ্যক' }), {
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

    // শপটা খুঁজে বের করা (পুরনো owner_id দরকার রিসেট করার জন্য)
    const { data: shop, error: shopFetchError } = await supabaseAdmin
      .from('shops')
      .select('id, name, owner_id')
      .eq('id', shopId)
      .single();

    if (shopFetchError || !shop) {
      return new Response(JSON.stringify({ error: 'শপ খুঁজে পাওয়া যায়নি' }), {
        status: 404, headers: { 'Content-Type': 'application/json' },
      });
    }

    // নতুন ওউনারকে ফোন নম্বর দিয়ে profiles এ খোঁজা
    const digitsOnly = newOwnerPhone.replace(/\D/g, '');
    const { data: newOwnerProfile, error: newOwnerError } = await supabaseAdmin
      .from('profiles')
      .select('id, shop_id, phone')
      .eq('phone', digitsOnly)
      .maybeSingle();

    if (newOwnerError || !newOwnerProfile) {
      return new Response(
        JSON.stringify({ error: 'এই ফোন নম্বরে কোনো অ্যাকাউন্ট পাওয়া যায়নি — নতুন ওউনারকে আগে সাইটে অ্যাকাউন্ট খুলতে হবে' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // নতুন ওউনার যদি আগে থেকেই অন্য কোনো শপের মালিক হয়, আটকানো
    if (newOwnerProfile.shop_id && newOwnerProfile.shop_id !== shopId) {
      return new Response(
        JSON.stringify({ error: 'এই অ্যাকাউন্ট ইতিমধ্যে অন্য একটা শপের মালিক — একটা অ্যাকাউন্ট দিয়ে একটাই শপ চালানো যায়' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // শপের owner_id বদলানো
    const { error: updateShopError } = await supabaseAdmin
      .from('shops')
      .update({ owner_id: newOwnerProfile.id })
      .eq('id', shopId);

    if (updateShopError) {
      return new Response(
        JSON.stringify({ error: 'শপ আপডেট ব্যর্থ: ' + updateShopError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // পুরনো ওউনার রিসেট (থাকলে, আর যদি নতুন-পুরনো একই না হয়)
    if (shop.owner_id && shop.owner_id !== newOwnerProfile.id) {
      await supabaseAdmin
        .from('profiles')
        .update({ is_shop_owner: false, shop_id: null })
        .eq('id', shop.owner_id);
    }

    // নতুন ওউনার সেট
    const { error: newOwnerUpdateError } = await supabaseAdmin
      .from('profiles')
      .update({ is_shop_owner: true, shop_id: shopId })
      .eq('id', newOwnerProfile.id);

    if (newOwnerUpdateError) {
      return new Response(
        JSON.stringify({ error: 'শপ আপডেট হয়েছে কিন্তু নতুন ওউনারের প্রোফাইল আপডেট ব্যর্থ: ' + newOwnerUpdateError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, shopName: shop.name, newOwnerId: newOwnerProfile.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}