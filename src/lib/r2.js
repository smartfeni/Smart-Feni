// path: src/lib/r2.js
// ============================================================
// Cloudflare R2 (S3-সামঞ্জস্যপূর্ণ) PUT হেল্পার। কোনো বাইরের প্যাকেজ নেই:
// Node-এর crypto দিয়ে AWS SigV4 সাইন করা হয়।
// ব্যবহার: শুধু সার্ভার-সাইড API রুটে (upload-image, upload-avatar)।
// Vercel env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, R2_PUBLIC_BASE
// কোনো env না থাকলে r2Configured() false — তখন কলাররা আগের মতো Supabase-এ আপলোড করে।
// ============================================================

import { createHash, createHmac } from 'node:crypto';

function env(key) {
  const fromVite = typeof import.meta !== 'undefined' && import.meta.env ? import.meta.env[key] : '';
  const fromProc = typeof process !== 'undefined' && process.env ? process.env[key] : '';
  return String(fromVite || fromProc || '').trim();
}

export function r2Configured() {
  return !!(
    env('R2_ACCOUNT_ID') &&
    env('R2_ACCESS_KEY_ID') &&
    env('R2_SECRET_ACCESS_KEY') &&
    env('R2_BUCKET') &&
    env('R2_PUBLIC_BASE')
  );
}

// RFC 3986 অনুযায়ী এনকোড
function enc(s) {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}
function encKey(key) {
  return String(key).split('/').map(enc).join('/');
}
const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();

// পাবলিক URL (img.smartfeni.com/<key>)
export function r2PublicUrl(key) {
  return env('R2_PUBLIC_BASE').replace(/\/+$/, '') + '/' + encKey(key);
}

/**
 * R2-তে ফাইল রাখে। আগে থেকে একই key থাকলে ওভাররাইট করে না (If-None-Match: *) → { dup: true }।
 * @param {string} key  বাকেটের ভেতরের পাথ, যেমন "clubs/abc-123.jpg"
 * @param {Uint8Array|Buffer} body
 * @param {string} contentType
 * @returns {Promise<{ok: boolean, dup?: boolean, status: number}>}
 */
export async function r2Put(key, body, contentType) {
  const accountId = env('R2_ACCOUNT_ID');
  const accessKey = env('R2_ACCESS_KEY_ID');
  const secretKey = env('R2_SECRET_ACCESS_KEY');
  const bucket = env('R2_BUCKET');
  const host = accountId + '.r2.cloudflarestorage.com';
  const canonicalUri = '/' + enc(bucket) + '/' + encKey(key);

  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // 20261117T123000Z
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(body);
  const cacheControl = 'public, max-age=31536000, immutable';

  const headers = {
    'cache-control': cacheControl,
    'content-type': contentType || 'application/octet-stream',
    host: host,
    'if-none-match': '*',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => n + ':' + String(headers[n]).trim() + '\n').join('');
  const signedHeaders = names.join(';');
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = dateStamp + '/auto/s3/aws4_request';
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest)].join('\n');

  const kDate = hmac('AWS4' + secretKey, dateStamp);
  const kRegion = hmac(kDate, 'auto');
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization =
    'AWS4-HMAC-SHA256 Credential=' + accessKey + '/' + scope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature;

  const sendHeaders = {
    'Cache-Control': cacheControl,
    'Content-Type': headers['content-type'],
    'If-None-Match': '*',
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    Authorization: authorization,
  };

  const res = await fetch('https://' + host + canonicalUri, {
    method: 'PUT',
    headers: sendHeaders,
    body: body,
  });

  if (res.ok) return { ok: true, status: res.status };
  if (res.status === 412 || res.status === 409) return { ok: false, dup: true, status: res.status };
  return { ok: false, status: res.status };
}
