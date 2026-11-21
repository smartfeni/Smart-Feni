// path: src/pages/img/[...path].js
// ============================================================
// ছবি প্রক্সি (/img/<bucket>/<পাথ>): Supabase Storage-এর পাবলিক ছবি এনে
// কুকি ছেঁটে, ১ বছরের s-maxage সহ ফেরত দেয় — ফলে Vercel CDN ছবিটা cache
// করে এবং Supabase egress শুধু প্রথমবার খরচ হয়।
//
// কেন রিরাইট নয়: Supabase রেসপন্সে `set-cookie` থাকে, কুকিসহ রেসপন্স
// Vercel CDN cache করে না (প্রোডাকশনে x-vercel-cache: MISS দেখা গেছে)।
//
// নিরাপত্তা: ওপেন প্রক্সি নয়। শুধু নিচের তালিকার bucket, `..`/অদ্ভুত
// অক্ষর রিজেক্ট, শুধু GET/HEAD।
// ============================================================

export const prerender = false;

const ALLOWED_BUCKETS = new Set(['listing-images', 'delivery-shop-images', 'doctor-photos']);
const SAFE_SEGMENT = /^[A-Za-z0-9._~%-]+$/;
const CACHE_OK = 'public, max-age=31536000, s-maxage=31536000, immutable';
const CACHE_MISS = 'public, max-age=60, s-maxage=60';

function notFound() {
  return new Response('Not found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': CACHE_MISS },
  });
}

export async function GET({ params, request }) {
  const raw = params.path || '';
  const segments = raw.split('/');

  if (segments.length < 2 || !ALLOWED_BUCKETS.has(segments[0])) return notFound();
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..' || !SAFE_SEGMENT.test(seg)) return notFound();
  }

  const base = import.meta.env.PUBLIC_SUPABASE_URL;
  if (!base) return notFound();

  let upstream;
  try {
    upstream = await fetch(`${base}/storage/v1/object/public/${segments.join('/')}`, {
      headers: { Accept: request.headers.get('accept') || '*/*' },
    });
  } catch (e) {
    return new Response('Upstream error', {
      status: 502,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (!upstream.ok) return notFound();

  const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
  // শুধু ছবি ফেরত যাবে (HTML/SVG-স্ক্রিপ্ট ইত্যাদি নয়)
  if (!/^image\/(jpeg|png|webp|gif|avif)/i.test(contentType)) return notFound();

  const body = await upstream.arrayBuffer();

  // কুকি/অন্য upstream হেডার ইচ্ছে করে কপি করা হয়নি
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': CACHE_OK,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
