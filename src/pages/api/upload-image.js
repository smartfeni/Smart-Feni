// path: src/pages/api/upload-image.js
// ============================================================
// API এন্ডপয়েন্ট: জেনেরিক ছবি আপলোড (/api/upload-image)
// সাইটের যেকোনো জায়গার (club logo/cover, club posts, club members,
// listing images, admin site images, shop images ইত্যাদি) ছবি
// আপলোডের জন্য একটাই রিইউজেবল এন্ডপয়েন্ট। listing-images বাকেটে
// ইউজারের SELECT পলিসি না থাকায় ক্লায়েন্ট-সাইড আপলোড ফেইল করত, তাই
// এই রুট service role key দিয়ে আপলোড করে (অথরাইজেশন সার্ভারেই হয়)।
//
// ক্লায়েন্ট থেকে পাঠাতে হবে (multipart/form-data):
//   - file: আপলোড করার ফাইল/ব্লব
//   - path: বাকেটের ভেতরের পাথ (যেমন "clubs/xxx-logo-123.jpg")
//   - contentType (ঐচ্ছিক): এখন উপেক্ষা করা হয়, আসল ধরন বাইট দেখে ঠিক হয়
//
// আপডেট (ব্যাচ ১, ১৫ নভে ২০২৬ অডিট — আপলোড লক):
//   - শুধু অনুমোদিত ফোল্ডার (uploadGuard.js), পাথে শুধু নিরাপদ অক্ষর
//   - ফাইলের আসল বাইট দেখে jpeg/png/webp/gif ছাড়া সব reject; content-type
//     ক্লায়েন্টের নয়, বাইট থেকে ঠিক হয়; এক্সটেনশন আসল ধরনের সাথে মেলানো
//   - সাইজ সীমা ৪MB
//   - 'site/' ছাড়া upsert বন্ধ (অন্যের ছবি ওভাররাইট বন্ধ)। retry-তে "আগেই আছে"
//     এলে সফল ধরা হয় (আসল ফাইল বদলায় না)
//   - 'site/' ফোল্ডার শুধু images.manage পারমিশনের জন্য (আগের মতোই)
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { callerCan } from '../../lib/serverPermission.js';
import {
  MAX_UPLOAD_BYTES,
  sniffImageType,
  validateUploadPath,
  withExtension,
} from '../../lib/uploadGuard.js';
// এরর মনিটরিং (ধাপ ৯): ৫০০ পথ ও গিলে-ফেলা এরর অ্যাডমিন এরর লগে রিপোর্ট হয়
import { reportServerError } from '../../lib/serverErrorReporter.js';
import { r2Configured, r2Put, r2PublicUrl } from '../../lib/r2.js';

export const prerender = false;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function POST({ request }) {
  // এরর রিপোর্টের client: service role client তৈরির পর সেট হয়
  let reportDb = null;
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
    reportDb = supabaseAdmin;

    // টোকেন যাচাই করে আসল ইউজার আইডি বের করা হচ্ছে
    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(token);

    if (userError || !userData?.user) {
      return json({ error: 'সেশন যাচাই ব্যর্থ, আবার লগইন করুন' }, 401);
    }

    const userId = userData.user.id;

    const formData = await request.formData();
    const file = formData.get('file');
    const rawPath = formData.get('path');
    const explicitContentType = formData.get('contentType');

    if (!file || typeof file === 'string') {
      return json({ error: 'ফাইল পাওয়া যায়নি' }, 400);
    }
    if (!rawPath || typeof rawPath !== 'string') {
      return json({ error: 'পাথ পাওয়া যায়নি' }, 400);
    }

    // HEIC/HEIF ব্লক: কাঁচা iPhone ছবি (৪MB+) egress অনেক বাড়ায় আর Android ব্রাউজারে দেখাও যায় না
    const mimeHint = String(file.type || '') + ' ' + String(explicitContentType || '');
    if (/heic|heif/i.test(mimeHint) || /\.(heic|heif)$/i.test(rawPath)) {
      return json({ error: 'HEIC ছবি চলে না, ছবি JPEG বা PNG করে দিন' }, 415);
    }

    // সাইজ সীমা (বাইট পড়ার আগেই)
    if (typeof file.size === 'number' && file.size > MAX_UPLOAD_BYTES) {
      return json({ error: 'ছবি ৪MB-এর বেশি, ছোট করে দিন' }, 413);
    }

    const arrayBuffer = await file.arrayBuffer();
    if (arrayBuffer.byteLength > MAX_UPLOAD_BYTES) {
      return json({ error: 'ছবি ৪MB-এর বেশি, ছোট করে দিন' }, 413);
    }

    // আসল ধরন বাইট দেখে: jpeg/png/webp/gif ছাড়া কিছু নয়
    const sniffed = sniffImageType(new Uint8Array(arrayBuffer, 0, Math.min(16, arrayBuffer.byteLength)));
    if (!sniffed) {
      return json({ error: 'শুধু JPG, PNG, WEBP বা GIF ছবি আপলোড করা যায়' }, 415);
    }

    // 'site/'-এর বাইরে এক্সটেনশন আসল ধরনের সাথে মেলানো (ইউজারের ফাইলের নাম থেকে আসা
    // অদ্ভুত এক্সটেনশন এখানে ঠিক হয়)। 'site/'-এর ফিক্সড নাম (logo.png ইত্যাদি) অপরিবর্তিত।
    const looksSite = rawPath.startsWith('site/');
    const path = looksSite ? rawPath : withExtension(rawPath, sniffed.ext);

    const check = validateUploadPath(path);
    if (!check.ok) {
      return json({ error: check.error }, 400);
    }

    // 'site/' ফোল্ডার শুধু images.manage পারমিশনের জন্য — বাকি অনুমোদিত ফোল্ডার
    // যেকোনো লগইন ইউজারের জন্য উন্মুক্ত
    if (check.isSite) {
      if (!(await callerCan(supabaseAdmin, userId, 'images.manage'))) {
        return json({ error: 'এই ফোল্ডারে আপলোড করার অনুমতি নেই' }, 403);
      }
    }

    // R2 (Cloudflare): 'site/' ছাড়া সব নতুন ছবি এখানে যায়, egress ফ্রি।
    // R2 ব্যর্থ হলে নিচের Supabase আপলোডে ফলব্যাক, যাতে ইউজারের আপলোড কখনো আটকে না যায়।
    if (!check.isSite && r2Configured()) {
      try {
        const r2 = await r2Put(path, new Uint8Array(arrayBuffer), sniffed.type);
        if (r2.ok || r2.dup) {
          // dup: আগের চেষ্টাতেই আপলোড হয়েছিল, আসল ফাইল অক্ষত — সফল ধরা হলো
          return json({ url: r2PublicUrl(path), path }, 200);
        }
        console.error('upload-image R2 status:', r2.status);
        await reportServerError(reportDb, {
          route: '/api/upload-image',
          action: 'upload_image_r2_fallback',
          title: 'ছবি আপলোড: R2 ব্যর্থ, Supabase-এ ফলব্যাক',
          message: 'R2 status ' + r2.status,
          status: 500,
        });
      } catch (r2Err) {
        console.error('upload-image R2 error:', r2Err && r2Err.message);
        await reportServerError(reportDb, {
          route: '/api/upload-image',
          action: 'upload_image_r2_fallback',
          title: 'ছবি আপলোড: R2 ব্যর্থ, Supabase-এ ফলব্যাক',
          message: r2Err && r2Err.message,
          status: 500,
        });
      }
    }

    const { error: uploadError } = await supabaseAdmin.storage
      .from('listing-images')
      .upload(path, arrayBuffer, {
        // ওভাররাইট শুধু অ্যাডমিনের site/ ফাইলে (লোগো, হেডার ইত্যাদির ফিক্সড নাম)
        upsert: check.isSite,
        contentType: sniffed.type,
        cacheControl: '31536000',
      });

    if (uploadError) {
      const dup =
        String(uploadError.statusCode || '') === '409' ||
        /already exists|duplicate/i.test(String(uploadError.message || ''));
      if (!dup) {
        console.error('upload-image error:', uploadError.message);
        await reportServerError(reportDb, {
          route: '/api/upload-image',
          action: 'upload_image_storage',
          title: 'ছবি আপলোড (Storage) ব্যর্থ',
          message: uploadError.message,
          status: 500,
        });
        return json({ error: 'আপলোড ব্যর্থ: ' + uploadError.message }, 500);
      }
      // dup: আগের চেষ্টাতেই আপলোড হয়েছিল (রেসপন্স হারিয়েছে), আসল ফাইল অক্ষত — সফল ধরা হলো
    }

    const { data: publicData } = supabaseAdmin.storage.from('listing-images').getPublicUrl(path);

    return json({ url: publicData?.publicUrl || null, path }, 200);
  } catch (err) {
    console.error('upload-image API এরর:', err);
    await reportServerError(reportDb, {
      route: '/api/upload-image',
      action: 'upload_image_unexpected',
      title: 'ছবি আপলোড: অপ্রত্যাশিত ক্র্যাশ',
      message: err && err.message,
      status: 500,
    });
    return json({ error: 'অপ্রত্যাশিত সমস্যা হয়েছে' }, 500);
  }
}
