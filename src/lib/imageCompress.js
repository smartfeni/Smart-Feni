// path: src/lib/imageCompress.js
// ============================================================
// ইউটিলিটি: ইমেজ কম্প্রেশন (ক্লায়েন্ট-সাইড, canvas-ভিত্তিক)
// কেন লাগলো: Samsung/high-res ফোনের ছবি (৪-৮ MB) সরাসরি আপলোড হলে
// Vercel-এর 4.5MB body limit-এ আটকে যাচ্ছিল, আর লোডও স্লো হচ্ছিল।
// এই ফাংশন আপলোডের আগে ছবি রিসাইজ + কম্প্রেস করে দেয়।
//
// ব্যবহার:
//   import { compressImage } from '../../lib/imageCompress.js';
//   const compressed = await compressImage(file);
//   // অথবা একাধিক ফাইলের জন্য:
//   const compressed = await compressImages(fileList);
// ============================================================

const DEFAULT_MAX_DIMENSION = 1200;
const DEFAULT_QUALITY = 0.78;
const DEFAULT_SKIP_THRESHOLD = 200 * 1024; // 200KB — এর নিচে হলে কম্প্রেস না করলেও চলে

// ---------- HEIC/HEIF → JPEG (অডিট, ১৯ নভে ২০২৬) ----------
// Android-এর Chrome iPhone-এর HEIC ছবি canvas-এ খুলতে পারে না। আগে এমন ছবি ফেরত দেওয়া হতো
// ("JPG দিন")। এখন ব্রাউজার না খুলতে পারলে তবেই নিজেদের সাইট থেকে কনভার্টার (heic-to, LGPL,
// CSP-নিরাপদ বিল্ড, ~৭৮০KB gzip) লোড হয়, ছবি JPEG হয়ে আগের মতো কম্প্রেস হয়। সবার জন্য লোড হয় না।
// ভার্সন বদলালে ফোল্ডারের নামও বদলাও (ক্যাশ immutable)।
const HEIC_CONVERTER_URL = '/vendor/heic-to-1.6.7/heic-to.js';
let heicConverterPromise = null;

function loadHeicConverter() {
  if (!heicConverterPromise) {
    heicConverterPromise = import(/* @vite-ignore */ HEIC_CONVERTER_URL).catch((err) => {
      heicConverterPromise = null; // পরের বার আবার চেষ্টা
      throw err;
    });
  }
  return heicConverterPromise;
}

// HEIC → JPEG File; ব্যর্থ হলে null (কলার আগের মতো "JPG দিন" দেখায়)
async function convertHeicToJpeg(file) {
  try {
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('ছবি প্রস্তুত হচ্ছে…');
    }
    const mod = await loadHeicConverter();
    const blob = await mod.heicTo({ blob: file, type: 'image/jpeg', quality: 0.9 });
    if (!blob || !blob.size) return null;
    return new File([blob], renameToExt(file.name, 'image/jpeg'), {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });
  } catch (err) {
    try {
      if (typeof window !== 'undefined' && typeof window.SFReportError === 'function') {
        window.SFReportError({ kind: 'other', action: 'heic_convert', title: 'HEIC ছবি কনভার্ট ব্যর্থ', message: String((err && err.message) || err) });
      }
    } catch (_) { /* রিপোর্ট ব্যর্থ হলেও চলবে */ }
    return null;
  }
}

export function compressImage(file, options = {}) {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_QUALITY,
    mimeType = 'image/jpeg',
    skipIfSmallerThan = DEFAULT_SKIP_THRESHOLD,
  } = options;

  return new Promise((resolve) => {
    // কিছু Android পিকার HEIC-এর type খালি দেয়, তাই নাম দেখেও HEIC ধরা হয়
    if (!file || ((!file.type || !file.type.startsWith('image/')) && !isHeicFile(file))) {
      resolve(file); // ইমেজ না হলে হাত না দিয়ে ফেরত
      return;
    }

    // HEIC/HEIF: সব ব্রাউজার canvas-এ ডিকোড করতে পারে না (iPhone Safari পারে, Chrome পারে না)।
    // তাই আগেই স্কিপ না করে ডিকোড চেষ্টা করা হচ্ছে; না পারলে img.onerror-এ আসল ফাইল ফেরত
    // যায়, আর ক্যালার isHeicFile() দিয়ে সেটা আটকায় (ছবি বাছাই বা আপলোডের সময়)।

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);

      const { width, height } = img;
      const needsResize = width > maxDimension || height > maxDimension;
      const needsCompression = needsResize || file.size > skipIfSmallerThan;

      if (!needsCompression) {
        resolve(file); // ছবি এমনিতেই ছোট, কম্প্রেস না করলেও চলবে
        return;
      }

      let targetWidth = width;
      let targetHeight = height;
      if (needsResize) {
        if (width >= height) {
          targetWidth = maxDimension;
          targetHeight = Math.round((height / width) * maxDimension);
        } else {
          targetHeight = maxDimension;
          targetWidth = Math.round((width / height) * maxDimension);
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file); // ব্যর্থ হলে fallback হিসেবে original
            return;
          }
          const newName = renameToExt(file.name, mimeType);
          const compressedFile = new File([blob], newName, {
            type: mimeType,
            lastModified: Date.now(),
          });
          resolve(compressedFile);
        },
        mimeType,
        quality
      );
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      // ব্রাউজার HEIC খুলতে পারেনি → JPEG-এ কনভার্ট করে আবার কম্প্রেস (এক ধাপই, লুপ নয়)
      if (isHeicFile(file) && !options.__heicConverted) {
        convertHeicToJpeg(file).then((jpeg) => {
          if (!jpeg) {
            resolve(file); // কনভার্ট ব্যর্থ: আগের আচরণ (কলার isHeicFile দিয়ে আটকায়)
            return;
          }
          compressImage(jpeg, { ...options, __heicConverted: true }).then(resolve, () => resolve(jpeg));
        });
        return;
      }
      resolve(file); // fail-safe — কম্প্রেশন ব্যর্থ হলেও আপলোড আটকাবে না
    };

    img.src = objectUrl;
  });
}

// HEIC/HEIF কিনা (নাম বা টাইপ দেখে)। কমপ্রেসের পরেও HEIC থেকে গেলে বুঝতে হবে
// ব্রাউজার ডিকোড করতে পারেনি — ওই ছবি আপলোড করা যাবে না (৪MB+ কাঁচা ফাইল egress খায়)।
export function isHeicFile(file) {
  if (!file) return false;
  return /heic|heif/i.test(file.type || '') || /\.(heic|heif)$/i.test(file.name || '');
}

// একাধিক ফাইল (multi-image upload point) একসাথে কম্প্রেস করার জন্য
export async function compressImages(files, options = {}) {
  const fileArray = Array.from(files || []);
  const results = [];
  for (const file of fileArray) {
    results.push(await compressImage(file, options));
  }
  return results;
}

function renameToExt(originalName, mimeType) {
  const ext = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  const base = (originalName || 'image').replace(/\.[^.]+$/, '');
  return `${base}.${ext}`;
}