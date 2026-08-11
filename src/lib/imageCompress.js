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

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_QUALITY = 0.82;
const DEFAULT_SKIP_THRESHOLD = 500 * 1024; // 500KB — এর নিচে হলে কম্প্রেস না করলেও চলে

export function compressImage(file, options = {}) {
  const {
    maxDimension = DEFAULT_MAX_DIMENSION,
    quality = DEFAULT_QUALITY,
    mimeType = 'image/jpeg',
    skipIfSmallerThan = DEFAULT_SKIP_THRESHOLD,
  } = options;

  return new Promise((resolve) => {
    if (!file || !file.type || !file.type.startsWith('image/')) {
      resolve(file); // ইমেজ না হলে হাত না দিয়ে ফেরত
      return;
    }

    // HEIC/HEIF ব্রাউজারের canvas API দিয়ে ডিকোড করা যায় না —
    // স্কিপ করে original ফেরত দিচ্ছি, আপলোড আটকাবে না
    const isHeic = /heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name || '');
    if (isHeic) {
      resolve(file);
      return;
    }

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
      resolve(file); // fail-safe — কম্প্রেশন ব্যর্থ হলেও আপলোড আটকাবে না
    };

    img.src = objectUrl;
  });
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