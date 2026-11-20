// path: src/lib/imgProxy.js
// ============================================================
// Supabase Storage-এর পাবলিক ছবির URL-কে সাইটের নিজের /img/... পাথে বদলায়।
// vercel.json-এর রিরাইট ছবিটা Supabase থেকে এনে Vercel CDN-এ cache করে,
// ফলে একই ছবি বারবার Supabase থেকে নামে না (egress কমে)।
// অন্য কোনো URL (R2 ইত্যাদি) যেমন আছে তেমনই ফেরত যায়।
// ============================================================

const SB_PUBLIC = 'https://hedloawcvnbleehnurqd.supabase.co/storage/v1/object/public/';

export function proxyImg(url) {
  if (typeof url !== 'string') return url;
  return url.startsWith(SB_PUBLIC) ? '/img/' + url.slice(SB_PUBLIC.length) : url;
}
