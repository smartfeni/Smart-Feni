// path: src/pages/api/delete-shop.js
// ============================================================
// API এন্ডপয়েন্ট: শপ পার্মানেন্ট ডিলিট (/api/delete-shop)
// শুধু admin/moderator কল করতে পারবে। cascade ডিলিট করে:
//   ১. শুধু এই শপের প্রোডাক্ট লিস্টিং (listings.shop_id = এই শপ)
//   ২. এই শপের সব moderators রো
//   ৩. এই শপের সব orders (order_items নিজে থেকেই CASCADE-এ মুছে যায়)
//   ৪. এই শপের সব product_events (অ্যানালিটিক্স/ক্লিক-ট্র্যাকিং ডেটা)
//   ৫. profiles ঠিক করা (নিচের একাধিক-শপ নিয়ম দেখো)
//   ৬. shops টেবিলের রো
// অ্যাকাউন্ট (auth user) ডিলিট হয় না — শুধু শপ-সংক্রান্ত ডেটা।
//
// ✅ আপডেট (একাধিক শপ সাপোর্ট):
// - আগে ওউনারের (user_id + category='online-shop') সব লিস্টিং মুছে যেত —
//   এখন একাধিক শপ থাকলে অন্য শপের প্রোডাক্টও মুছে যেত। এখন listings.shop_id
//   দিয়ে শুধু এই শপের প্রোডাক্ট মুছে।
// - আগে ওউনারের প্রোফাইল সবসময় রিসেট হতো (is_shop_owner=false)। এখন ওউনারের
//   আরও শপ বাকি থাকলে is_shop_owner=true থাকে, আর profiles.shop_id এই শপের
//   হলে বাকি শপের একটায় সরিয়ে দেওয়া হয়। বাকি শপ না থাকলে আগের মতো রিসেট।
//
// FK নোট: profiles.shop_id → shops.id (ON DELETE NO ACTION), তাই shops রো
// ডিলিটের আগে এই শপের দিকে তাকিয়ে থাকা profiles.shop_id অবশ্যই সরাতে হবে।
// orders ও product_events-এও shop_id FK আছে, সেগুলোও আগে ক্লিন করা হয়।
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

    // ১. শুধু এই শপের প্রোডাক্ট লিস্টিং ডিলিট (ওউনারের অন্য শপ অক্ষত থাকে)
    await supabaseAdmin
      .from('listings')
      .delete()
      .eq('shop_id', shopId);

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

    // ৫. profiles ঠিক করা — shops রো ডিলিটের আগেই করতে হবে (FK)
    // ৫ক. যেসব প্রোফাইলের shop_id এই শপের দিকে আছে, আগে সবার null করা
    //     (ওউনার ছাড়াও আগের কোনো ওউনারের stale রেফারেন্স থাকলে সেটাও)
    await supabaseAdmin
      .from('profiles')
      .update({ shop_id: null })
      .eq('shop_id', shopId);

    // ৫খ. ওউনারের বাকি শপ আছে কিনা দেখা
    if (shop.owner_id) {
      const { data: remainingShops } = await supabaseAdmin
        .from('shops')
        .select('id')
        .eq('owner_id', shop.owner_id)
        .neq('id', shopId)
        .order('created_at', { ascending: true });

      if (remainingShops && remainingShops.length > 0) {
        // আরও শপ আছে → ওউনার ফ্ল্যাগ থাকবে, shop_id বাকি শপের প্রথমটায়
        await supabaseAdmin
          .from('profiles')
          .update({ is_shop_owner: true, shop_id: remainingShops[0].id })
          .eq('id', shop.owner_id);
      } else {
        // এটাই শেষ শপ → আগের মতো রিসেট (অ্যাকাউন্ট ডিলিট হয় না)
        await supabaseAdmin
          .from('profiles')
          .update({ is_shop_owner: false, shop_id: null })
          .eq('id', shop.owner_id);
      }
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
