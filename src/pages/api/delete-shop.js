// path: src/pages/api/delete-shop.js
// ============================================================
// API এন্ডপয়েন্ট: শপ পার্মানেন্ট ডিলিট (/api/delete-shop)
// শুধু admin/moderator কল করতে পারবে। cascade ডিলিট করে:
//   ১. শপ ওউনারের সব 'online-shop' ক্যাটাগরির listings
//   ২. এই শপের সব moderators রো
//   ৩. এই শপের সব orders (order_items নিজে থেকেই CASCADE-এ মুছে যায়)
//   ৪. এই শপের সব product_events (অ্যানালিটিক্স/ক্লিক-ট্র্যাকিং ডেটা)
//   ৫. আগের ওউনারের profiles রিসেট (is_shop_owner=false, shop_id=null)
//   ৬. shops টেবিলের রো
// অ্যাকাউন্ট (auth user) ডিলিট হয় না — শুধু শপ-সংক্রান্ত ডেটা।
//
// আপডেট (FK ফিক্স): profiles.shop_id কলামে shops.id এর ওপর ফরেন-কি
// আছে (ON DELETE NO ACTION) — তাই shops রো ডিলিট করার আগে
// profiles.shop_id অবশ্যই null করতে হবে, নাহলে
// "violates foreign key constraint profiles_shop_id_fkey" এরর দেয়।
// আগে এই ধাপ shops ডিলিটের পরে ছিল, যেটা সবসময় ফেইল করত। এখন
// profile রিসেট শপ ডিলিটের আগে করা হচ্ছে। একই কারণে orders ও
// product_events টেবিলেও shop_id ফরেন-কি আছে — এই দুটোও শপ ডিলিটের
// আগে ক্লিন করে দেওয়া হচ্ছে।
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

    // caller admin/moderator কিনা যাচাই
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

    // ১. এই শপের ওউনারের সব online-shop লিস্টিং ডিলিট
    if (shop.owner_id) {
      await supabaseAdmin
        .from('listings')
        .delete()
        .eq('user_id', shop.owner_id)
        .eq('category', 'online-shop');
    }

    // ২. এই শপের সব মডারেটর রো ডিলিট
    await supabaseAdmin
      .from('moderators')
      .delete()
      .eq('entity_type', 'shop')
      .eq('entity_id', shopId);

    // ৩. এই শপের সব অর্ডার ডিলিট (order_items নিজে থেকেই CASCADE-এ মুছে যায়)
    await supabaseAdmin
      .from('orders')
      .delete()
      .eq('shop_id', shopId);

    // ৪. এই শপের সব product_events (অ্যানালিটিক্স ডেটা) ডিলিট
    await supabaseAdmin
      .from('product_events')
      .delete()
      .eq('shop_id', shopId);

    // ৫. ওউনারের প্রোফাইল রিসেট — shops রো ডিলিটের আগেই করতে হবে,
    // কারণ profiles.shop_id ফরেন-কি shops.id কে রেফারেন্স করে
    // (অ্যাকাউন্ট ডিলিট হয় না, শুধু ফ্ল্যাগ রিসেট)
    if (shop.owner_id) {
      await supabaseAdmin
        .from('profiles')
        .update({ is_shop_owner: false, shop_id: null })
        .eq('id', shop.owner_id);
    }

    // ৬. shops রো ডিলিট
    const { error: deleteShopError } = await supabaseAdmin
      .from('shops')
      .delete()
      .eq('id', shopId);

    if (deleteShopError) {
      return new Response(
        JSON.stringify({ error: 'শপ ডিলিট ব্যর্থ: ' + deleteShopError.message }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, shopName: shop.name }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'অপ্রত্যাশিত ত্রুটি: ' + err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
