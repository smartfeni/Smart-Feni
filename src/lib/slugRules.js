// ============================================================
// শেয়ার্ড স্লাগ রুলস — শপ/ক্লাবের top-level URL (smartfeni.com/[slug])
// এই ফাইল ব্রাউজার (admin/shops.astro) আর সার্ভার API (check-shop-slug,
// approve-shop-request, update-shop-slug) দুই জায়গা থেকেই import হয়,
// তাই এখানে কোনো Node-only বা Supabase client import নেই।
//
// কেন দরকার: স্লাগ clubs ও shops দুই টেবিলে আলাদা unique index দিয়ে
// আটকানো, কিন্তু দুই টেবিলের মধ্যে কোনো DB constraint নেই — তাই "available
// কিনা" চেক অ্যাপ লেভেলে দুই টেবিলেই করতে হয়। সাথে সাইটের আসল রুট
// (src/pages-এর ফাইল/ফোল্ডার) থাকলে সেই নামে শপ খুললে শপ পেজ কখনো খুলত না
// (স্ট্যাটিক রুট [slug]-এর আগে ম্যাচ করে), তাই reserved তালিকায় সেগুলোও আছে।
//
// ⚠️ src/pages-এ নতুন root-level পেজ/ফোল্ডার যোগ করলে নিচের তালিকায়ও যোগ করো।
// ⚠️ create-shop.js ও create-club.js এখনো নিজেদের পুরনো ছোট তালিকা ব্যবহার করে
// (এই ফাইল ব্যবহার করে না) — পরে এক জায়গায় আনা দরকার।
// ============================================================

export const SLUG_MIN = 3;
export const SLUG_MAX = 40;

export const RESERVED_SLUGS = [
  // সার্ভিস ক্যাটাগরি
  'housing', 'job', 'repair', 'car-rental', 'courier', 'emergency',
  'blood', 'home-food', 'recycle', 'tuition', 'sports', 'lost-found',
  'health', 'legal', 'event', 'laundry', 'doctor-directory', 'online-shop',
  // src/pages-এর root-level রুট
  'about', 'admin', 'api', 'become-a-shop-owner', 'cart', 'checkout', 'clubs',
  'delivery-hero', 'doctor', 'index', 'listing', 'my-clinic', 'my-club',
  'my-listings', 'my-orders', 'my-shop', 'privacy-policy', 'product', 'profile',
  'r', 'refer', 'reset-password', 'ride-hero', 'services', 'shop',
  'terms-of-service',
  // public/ ফোল্ডার ও ভবিষ্যতের জন্য সাধারণ নাম
  'contact', 'data', 'icons', 'images', 'assets', 'login', 'signup',
  'register', 'help', 'faq', 'privacy', 'terms', 'sitemap', 'robots',
];

// ইংরেজি ছোট অক্ষর/সংখ্যা/হাইফেন ছাড়া সব বাদ; শুরু-শেষের হাইফেনও বাদ।
// বাংলা নাম দিলে ফল ফাঁকা স্ট্রিং আসে (আগে এ থেকেই "-" ও "--2" স্লাগ তৈরি হয়েছিল)।
export function slugify(input) {
  return String(input || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ফরম্যাট ঠিক থাকলে null, নইলে বাংলা এরর মেসেজ (slug আগেই slugify করা ধরে নেওয়া হয়)
export function validateSlugFormat(slug) {
  if (!slug) {
    return 'স্লাগ দিন — শুধু ইংরেজি ছোট অক্ষর, সংখ্যা ও হাইফেন (যেমন rahims-shop)';
  }
  if (slug.length < SLUG_MIN) {
    return `স্লাগ কমপক্ষে ${SLUG_MIN} অক্ষরের হতে হবে`;
  }
  if (slug.length > SLUG_MAX) {
    return `স্লাগ সর্বোচ্চ ${SLUG_MAX} অক্ষরের হতে পারবে`;
  }
  return null;
}

export function notAvailableMessage(slug) {
  return `Not Available — "${slug}" স্লাগটি আগে থেকেই ব্যবহৃত বা সংরক্ষিত, অন্য একটা দিন`;
}

// clubs + shops দুই টেবিলেই চেক করে (দুটোই একই /[slug] namespace শেয়ার করে)।
// excludeShopId: স্লাগ এডিটের সময় নিজের শপকে বাদ দিতে।
// ফেরত: { available: boolean, reason?: 'reserved' | 'club' | 'shop' | 'error' }
export async function checkSlugAvailability(supabaseAdmin, slug, { excludeShopId } = {}) {
  if (RESERVED_SLUGS.includes(slug)) {
    return { available: false, reason: 'reserved' };
  }

  const [clubRes, shopRes] = await Promise.all([
    supabaseAdmin.from('clubs').select('id').eq('slug', slug).maybeSingle(),
    supabaseAdmin.from('shops').select('id').eq('slug', slug).maybeSingle(),
  ]);

  if (clubRes.error || shopRes.error) {
    return { available: false, reason: 'error' };
  }

  if (clubRes.data) {
    return { available: false, reason: 'club' };
  }

  if (shopRes.data && shopRes.data.id !== excludeShopId) {
    return { available: false, reason: 'shop' };
  }

  return { available: true };
}

// স্লাগ না দিলে approve-এর পুরনো auto আচরণ: base, base-2, base-3 ...
// base ফাঁকা বা খুব ছোট (যেমন বাংলা নাম) হলে "shop" থেকে শুরু।
export async function generateUniqueSlug(supabaseAdmin, name) {
  const cleaned = slugify(name);
  const base = cleaned.length >= SLUG_MIN ? cleaned : 'shop';

  let candidate = base;
  let suffix = 2;

  for (let i = 0; i < 50; i++) {
    const result = await checkSlugAvailability(supabaseAdmin, candidate);
    if (result.reason === 'error') {
      throw new Error('স্লাগ চেক করা যায়নি (ডাটাবেস ত্রুটি)');
    }
    if (result.available) return candidate;
    candidate = `${base}-${suffix}`;
    suffix++;
  }

  return `${base}-${Date.now().toString(36)}`;
}
