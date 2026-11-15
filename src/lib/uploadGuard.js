// path: src/lib/uploadGuard.js
// ============================================================
// /api/upload-image-এর নিরাপত্তা-হেল্পার (ব্যাচ ১, ১৫ নভে ২০২৬ অডিট):
//   - ফাইলের আসল বাইট দেখে ছবির ধরন চেনা (ক্লায়েন্টের content-type বিশ্বাস নয়)
//   - অনুমোদিত ফোল্ডার ও পাথের গঠন যাচাই
//   - এক্সটেনশন আসল ধরনের সাথে মিলিয়ে দেওয়া
// ============================================================

export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024; // Vercel রিকোয়েস্ট সীমা ~৪.৫MB

// যেসব টপ-লেভেল ফোল্ডারে আপলোড চলে। 'site' শুধু অ্যাডমিন (images.manage)।
export const ALLOWED_FOLDERS = new Set([
  'site',
  'club-members',
  'club-posts',
  'clubs',
  'online-shop',
  'shops',
  // লিস্টিং ক্যাটাগরি (AddListingModal-এর category = ফোল্ডার)
  'housing',
  'job',
  'repair',
  'car-rental',
  'courier',
  'ride',
  'emergency',
  'blood',
  'home-food',
  'recycle',
  'tuition',
  'sports',
  'lost-found',
  'event',
  'laundry',
  'doctor-directory',
  'local-ride',
]);

const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/**
 * ফাইলের প্রথম বাইট দেখে ছবির ধরন বলে। চেনা না গেলে null।
 * @param {Uint8Array} bytes
 * @returns {{ type: string, ext: string } | null}
 */
export function sniffImageType(bytes) {
  if (!bytes || bytes.length < 12) return null;
  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { type: 'image/jpeg', ext: 'jpg' };
  }
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return { type: 'image/png', ext: 'png' };
  }
  // GIF: "GIF87a" / "GIF89a"
  if (
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61
  ) {
    return { type: 'image/gif', ext: 'gif' };
  }
  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return { type: 'image/webp', ext: 'webp' };
  }
  return null;
}

/**
 * পাথের শেষ অংশের এক্সটেনশন আসল ধরনের এক্সটেনশন দিয়ে বদলায় (না থাকলে যোগ করে)।
 * ইউজারের ফাইলের নাম থেকে আসা অদ্ভুত এক্সটেনশন এভাবে ঠিক হয়ে যায়।
 */
export function withExtension(path, ext) {
  const i = path.lastIndexOf('/');
  const dir = path.slice(0, i + 1);
  const base = path.slice(i + 1).replace(/\.[^.]*$/, '');
  return `${dir}${base}.${ext}`;
}

/**
 * আপলোড পাথ যাচাই।
 * @returns {{ ok: true, folder: string, isSite: boolean } | { ok: false, error: string }}
 */
export function validateUploadPath(path) {
  if (typeof path !== 'string' || path.length === 0 || path.length > 150) {
    return { ok: false, error: 'অবৈধ পাথ' };
  }
  if (!PATH_RE.test(path) || path.includes('..') || path.includes('//') || path.endsWith('/')) {
    return { ok: false, error: 'অবৈধ পাথ' };
  }
  const segs = path.split('/');
  if (segs.length < 2 || segs.length > 3) {
    return { ok: false, error: 'অবৈধ পাথ' };
  }
  for (const s of segs) {
    if (!s || s.startsWith('.') || s.length > 100) {
      return { ok: false, error: 'অবৈধ পাথ' };
    }
  }
  const folder = segs[0];
  if (!ALLOWED_FOLDERS.has(folder)) {
    return { ok: false, error: 'এই ফোল্ডারে আপলোড চলে না' };
  }
  return { ok: true, folder, isSite: folder === 'site' };
}
