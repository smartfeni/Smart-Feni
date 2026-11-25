// ============================================================
// Smart Feni — লিস্টিং কার্ডের ছোট ছবি (থাম্বনেইল)
//
// লিস্টিংয়ের ছবি Cloudflare R2-এ (img.smartfeni.com), আসল মাপ ~১২০০px।
// কার্ডে দেখায় ~২০০px, তাই Cloudflare Image Transformations দিয়ে ৪০০px WebP/AVIF:
//   https://img.smartfeni.com/cdn-cgi/image/width=400,.../<পাথ>
// খরচ: Cloudflare ফ্রি প্ল্যানে মাসে ৫,০০০ ইউনিক ট্রান্সফর্মেশন ফ্রি; সীমা পেরোলে বিল হয় না,
// নতুন থাম্বনেইল ফেইল করে — তখন onerror আসল ছবিতে ফিরে যায় (thumbFallback)।
//
// চালু/বন্ধ: Vercel env PUBLIC_IMG_THUMBS=1 (Cloudflare ড্যাশবোর্ডে img.smartfeni.com জোনে
// Images → Transformations চালু করার পরে)। না থাকলে আসল URL-ই ফেরত দেয়, কিছু বদলায় না।
// ============================================================

const ON = import.meta.env.PUBLIC_IMG_THUMBS === '1';
const HOST = 'https://img.smartfeni.com/';

export function thumbUrl(url, width = 400) {
  if (!ON || typeof url !== 'string' || !url.startsWith(HOST)) return url;
  const path = url.slice(HOST.length);
  if (!path || path.startsWith('cdn-cgi/')) return url;
  return `${HOST}cdn-cgi/image/width=${width},quality=75,format=auto,fit=scale-down/${path}`;
}

// <img onerror={thumbFallback} data-full={আসল URL}> — থাম্বনেইল না এলে একবার আসল ছবি
export const thumbFallback = "if(this.dataset.full&&this.src!==this.dataset.full){this.src=this.dataset.full}";
