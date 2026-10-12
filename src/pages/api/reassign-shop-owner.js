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
// ৪. shops.owner_id নতুন user_id তে বদলানো
// ৫. পুরনো ওউনারের profiles ঠিক করা: বাকি শপ না থাকলে রিসেট
//    (is_shop_owner=false, shop_id=null); বাকি শপ থাকলে is_shop_owner=true থাকে,
//    আর profiles.shop_id এই শপের হলে বাকি শপের একটায় সরানো হয়
// ৬. নতুন ওউনারের profiles সেট: is_shop_owner=true; shop_id শুধু তখনই বসে
//    যখন তার আগে কোনো shop_id নেই
//
// আপডেট (একাধিক শপ): "এক অ্যাকাউন্ট = এক শপ" বাধা সরানো হয়েছে — নতুন ওউনার
// আগে থেকে অন্য শপের মালিক হলেও আরেকটা শপ পাবে। পুরনো ওউনারের আরও শপ থাকলে
// তার ওউনার ফ্ল্যাগ আর রিসেট হয় না।
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

    // পুরনো ওউনারের প্রোফাইল ঠিক করা (থাকলে, আর যদি নতুন-পুরনো একই না হয়)
    if (shop.owner_id && shop.owner_id !== newOwnerProfile.id) {
      const [{ data: oldOwnerProfile }, { data: remainingShops }] = await Promise.all([
        supabaseAdmin.from('profiles').select('shop_id').eq('id', shop.owner_id).maybeSingle(),
        supabaseAdmin
          .from('shops')
          .select('id')
          .eq('owner_id', shop.owner_id)
          .order('created_at', { ascending: true }),
      ]);

      if (remainingShops && remainingShops.length > 0) {
        // আরও শপ আছে → ওউনার ফ্ল্যাগ থাকবে; shop_id এই শপের হলে বাকি শপে সরানো
        const oldUpdate = { is_shop_owner: true };
        if (oldOwnerProfile?.shop_id === shopId || !oldOwnerProfile?.shop_id) {
          oldUpdate.shop_id = remainingShops[0].id;
        }
        await supabaseAdmin.from('profiles').update(oldUpdate).eq('id', shop.owner_id);
      } else {
        // এটাই শেষ শপ ছিল → আগের মতো রিসেট
        await supabaseAdmin
          .from('profiles')
          .update({ is_shop_owner: false, shop_id: null })
          .eq('id', shop.owner_id);
      }
    }

    // নতুন ওউনার সেট — আগে থেকে shop_id থাকলে ওভাররাইট করা হয় না
    const newOwnerUpdate = { is_shop_owner: true };
    if (!newOwnerProfile.shop_id) {
      newOwnerUpdate.shop_id = shopId;
    }

    const { error: newOwnerUpdateError } = await supabaseAdmin
      .from('profiles')
      .update(newOwnerUpdate)
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