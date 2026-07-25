// ============================================================
// API এন্ডপয়েন্ট: প্রোফাইল ছবি আপলোড (/api/upload-avatar)
// আগে ক্লায়েন্ট থেকে সরাসরি supabase.storage.upload() কল করা হতো,
// কিন্তু Storage সার্ভিস ইউজার-সেশন JWT ভেরিফাই করতে বারবার ব্যর্থ
// হচ্ছিল ("new row violates row-level security policy" — সেশন/RLS
// পলিসি ঠিক থাকা সত্ত্বেও, লগে বহুবার কনফার্ম করা হয়েছে)।
// এই রুট service role key দিয়ে সরাসরি আপলোড করে, তাই ওই
// ভেরিফিকেশন ধাপটাই বাইপাস হয়ে যায়। ইউজারের পরিচয় client-এর
// পাঠানো userId থেকে না নিয়ে, Authorization header-এর access
// token থেকে সার্ভার নিজে যাচাই করে বের করে (নিরাপত্তার জন্য)।
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

    // টোকেন যাচাই করে আসল ইউজার আইডি বের করা হচ্ছে — ক্লায়েন্ট থেকে
    // পাঠানো কোনো userId কখনো সরাসরি বিশ্বাস করা হয় না
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      return json({ error: 'সেশন যাচাই ব্যর্থ, আবার লগইন করুন' }, 401);
    }

    const userId = userData.user.id;

    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || typeof file === 'string') {
      return json({ error: 'ফাইল পাওয়া যায়নি' }, 400);
    }

    const fileExt = (file.name || 'jpg').split('.').pop();
    const filePath = `avatars/${userId}-${Date.now()}.${fileExt}`;
    const arrayBuffer = await file.arrayBuffer();

    const { error: uploadError } = await supabaseAdmin.storage
      .from('listing-images')
      .upload(filePath, arrayBuffer, {
        upsert: true,
        contentType: file.type || 'image/jpeg',
      });

    if (uploadError) {
      console.error('avatar upload error:', uploadError.message);
      return json({ error: 'ছবি আপলোড ব্যর্থ: ' + uploadError.message }, 500);
    }

    const { data: publicData } = supabaseAdmin.storage.from('listing-images').getPublicUrl(filePath);

    return json({ url: publicData?.publicUrl || null }, 200);
  } catch (err) {
    console.error('upload-avatar API এরর:', err);
    return json({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }, 500);
  }
}