// src/lib/storageSigned.js
// private bucket (delivery-proofs, chat-images) এর ছবির জন্য signed URL হেল্পার।
// DB-তে পুরনো public URL বা শুধু path — দুটোই সাপোর্ট করে, তাই ডেটা বদলাতে হয় না।
// supabase client প্যারামিটার হিসেবে নেয় (src/lib/supabase.js এর singleton পাস করো)।

const PUBLIC_MARK = '/storage/v1/object/public/';
const DEFAULT_TTL = 3600; // সেকেন্ড (১ ঘণ্টা)

// cache: "bucket|path" -> { url, exp }
const cache = new Map();

// সেভ করা মান থেকে bucket-এর ভেতরের path বের করে। না পেলে null।
export function extractPath(value, bucket) {
  if (!value || typeof value !== 'string') return null;
  if (!/^https?:\/\//i.test(value)) return value.replace(/^\/+/, ''); // আগে থেকেই path
  const marker = PUBLIC_MARK + bucket + '/';
  const i = value.indexOf(marker);
  if (i === -1) return null; // অন্য bucket/সাইটের URL
  const raw = value.slice(i + marker.length).split('?')[0];
  try {
    return decodeURIComponent(raw);
  } catch (_) {
    return raw;
  }
}

// একটা ছবির signed URL। কিছু ভুল হলে মূল মানটাই ফেরত দেয় (UI ভাঙবে না)।
export async function getSignedUrl(supabase, bucket, value, expiresIn = DEFAULT_TTL) {
  const path = extractPath(value, bucket);
  if (!path) return value || '';
  const key = bucket + '|' + path;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now() + 60000) return hit.url;
  try {
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
    if (error || !data?.signedUrl) return value || '';
    cache.set(key, { url: data.signedUrl, exp: Date.now() + expiresIn * 1000 });
    return data.signedUrl;
  } catch (_) {
    return value || '';
  }
}

// একসাথে অনেক ছবি (অর্ডার সংরক্ষণ করে)।
export async function getSignedUrls(supabase, bucket, values, expiresIn = DEFAULT_TTL) {
  return Promise.all((values || []).map((v) => getSignedUrl(supabase, bucket, v, expiresIn)));
}
