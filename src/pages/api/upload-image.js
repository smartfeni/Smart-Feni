// path: src/pages/api/upload-image.js
// ============================================================
// API এন্ডপয়েন্ট: জেনেরিক ছবি আপলোড (/api/upload-image)
// সাইটের যেকোনো জায়গার (club logo/cover, club posts, club members,
// listing images, admin site images, shop images ইত্যাদি) ছবি
// আপলোডের জন্য একটাই রিইউজেবল এন্ডপয়েন্ট। আগে প্রতিটা জায়গায়
// আলাদাভাবে client-side supabase.storage.upload() কল করা হতো,
// কিন্তু Storage সার্ভিস ইউজার-সেশন JWT ভেরিফাই করতে ব্যর্থ হচ্ছিল
// ("new row violates row-level security policy" — সেশন/RLS পলিসি
// ঠিক থাকা সত্ত্বেও, লগে বহুবার কনফার্ম করা হয়েছে, দেখুন
// /api/upload-avatar.js-এর কমেন্ট)। এই রুট service role key দিয়ে
// সরাসরি আপলোড করে, তাই ওই ভেরিফিকেশন ধাপটাই বাইপাস হয়ে যায়।
//
// আপডেট: আপলোডের সময় cacheControl: '31536000' (১ বছর) সেট করা
// হচ্ছে। আগে এটা না দেওয়ায় Supabase ডিফল্ট max-age=3600 (১ ঘণ্টা)
// বসাতো, ফলে প্রতি ঘণ্টায় ব্রাউজার ছবি re-fetch করত। যেহেতু
// ক্লায়েন্ট সাইডে ইতিমধ্যে ?t=updated_at cache-busting query param
// ব্যবহার হয় (ছবি বদলালে URL-ই বদলে যায়), তাই লম্বা cache
// নিরাপদ — নতুন ছবি আপলোড হলে নতুন URL-এর সাথে আবার fresh fetch
// হবে, পুরনো URL cache-এই থেকে যাবে (ক্ষতি নেই)।
//
// ক্লায়েন্ট থেকে পাঠাতে হবে (multipart/form-data):
//   - file: আপলোড করার ফাইল/ব্লব
//   - path: বাকেটের ভেতরের সম্পূর্ণ পাথ (যেমন "clubs/xxx-logo-123.jpg")
//   - contentType (ঐচ্ছিক): নির্দিষ্ট mime type দিতে চাইলে (Blob-এর জন্য)
//
// নিরাপত্তা: Authorization header-এর access token সার্ভার নিজে
// যাচাই করে ইউজার আইডি বের করে (ক্লায়েন্টের দাবি বিশ্বাস করা হয় না)।
// 'site/' দিয়ে শুরু হওয়া পাথ শুধু admin/moderator আপলোড করতে
// পারবে — এটা আগের storage RLS পলিসির (restrict_site_folder_writes)
// সমতুল্য নিয়ম, শুধু এখন সার্ভার-সাইডে চেক করা হচ্ছে।
// ============================================================

import { createClient } from '@supabase/supabase-js';

export const prerender = false;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  try {
    const authHeader = request.headers.get('authorization') || '';
    const token = authHeader.replace('Bearer ', '').trim();

    if (!token) {
      return json({ error: 'অনুমতি নেই, আগে লগইন করুন' }, 401);
    }

    const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
    const serviceRoleKey = import.meta.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      return json({ error: 'সার্ভার কনফিগারেশন ঠিক নেই' }, 500);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // টোকেন যাচাই করে আসল ইউজার আইডি বের করা হচ্ছে
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      return json({ error: 'সেশন যাচাই ব্যর্থ, আবার লগইন করুন' }, 401);
    }

    const userId = userData.user.id;

    const formData = await request.formData();
    const file = formData.get('file');
    const path = formData.get('path');
    const explicitContentType = formData.get('contentType');

    if (!file || typeof file === 'string') {
      return json({ error: 'ফাইল পাওয়া যায়নি' }, 400);
    }
    if (!path || typeof path !== 'string') {
      return json({ error: 'পাথ পাওয়া যায়নি' }, 400);
    }
    if (path.includes('..')) {
      return json({ error: 'অবৈধ পাথ' }, 400);
    }

    // 'site/' ফোল্ডার শুধু admin/moderator-এর জন্য — বাকি সব ফোল্ডার
    // (avatars, clubs, club-posts, club-members, listing ইত্যাদি)
    // যেকোনো লগইন করা ইউজারের জন্য উন্মুক্ত
    if (path.startsWith('site/')) {
      const { data: profile } = await supabaseAdmin
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (!profile || !['admin', 'moderator'].includes(profile.role)) {
        return json({ error: 'এই ফোল্ডারে আপলোড করার অনুমতি নেই' }, 403);
      }
    }

    const contentType = (typeof explicitContentType === 'string' && explicitContentType) || file.type || 'application/octet-stream';
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage
      .from('listing-images')
      .upload(path, arrayBuffer, {
        upsert: true,
        contentType,
        cacheControl: '31536000',
      });

    if (uploadError) {
      console.error('upload-image error:', uploadError.message);
      return json({ error: 'আপলোড ব্যর্থ: ' + uploadError.message }, 500);
    }

    const { data: publicData } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path);

    return json({ url: publicData?.publicUrl || null, path }, 200);
  } catch (err) {
    console.error('upload-image API এরর:', err);
    return json({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }, 500);
  }
}