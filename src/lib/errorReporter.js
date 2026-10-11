// src/lib/errorReporter.js
// ইউজার-ফেসিং এরর অটো-রিপোর্টার: public.report_client_error() RPC কল করে।
// ব্যবহার:
//   import { reportError, initErrorReporter } from '../lib/errorReporter.js';
//   reportError({ kind: 'db_block', action: 'profile_save', message: error.message, code: error.code, title: 'প্রোফাইল সেভ ফেইল' });
//   initErrorReporter(); // BaseLayout থেকে একবার (ধাপ ৩)
// এই ফাইল কখনো throw করে না।

const MAX_MSG = 300;
const MAX_PER_PAGE_LOAD = 10;
const VALID_KINDS = ['db_block', 'api_fail', 'js_crash', 'other'];

const seen = new Set(); // সেশনে একই এরর ১ বার
let sentCount = 0;
let reporting = false; // লুপ গার্ড
let initialized = false;

// ---------- ফিল্টার ----------
function isExtensionNoise(text) {
  return /(chrome|moz|safari|safari-web)-extension:\/\//i.test(text || '');
}

function isIgnorable(message, stack, filename) {
  const msg = String(message || '');
  if (!msg) return true;
  if (isExtensionNoise(stack) || isExtensionNoise(filename) || isExtensionNoise(msg)) return true;
  if (/ResizeObserver loop/i.test(msg)) return true;
  if (/^Script error\.?$/i.test(msg.trim())) return true;
  if (/AbortError|The user aborted a request|signal is aborted/i.test(msg)) return true;
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      if (/failed to fetch|networkerror|load failed|network request failed/i.test(msg)) return true;
    }
  } catch (_) {}
  return false;
}

// ---------- মেসেজ পরিষ্কার ----------
function cleanMessage(message) {
  let m = String(message == null ? '' : message);
  m = m.replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[token]'); // JWT
  m = m.replace(/[?#][^\s"')\]]*/g, ''); // URL query / hash কেটে ফেলা
  m = m.replace(/\s+/g, ' ').trim();
  return m.slice(0, MAX_MSG);
}

// ---------- Supabase ক্লায়েন্ট (singleton) ----------
async function getClient() {
  if (typeof window === 'undefined') return null;
  if (window.__smartFeniSupabaseClient) return window.__smartFeniSupabaseClient;
  try {
    const mod = await import('./supabase.js');
    return mod.supabase || mod.default || null;
  } catch (_) {
    return null;
  }
}

// ---------- মূল ফাংশন ----------
export async function reportError(opts) {
  try {
    if (typeof window === 'undefined') return;
    if (reporting) return; // রিপোর্টিং চলাকালীন এরর আবার রিপোর্ট নয়
    if (sentCount >= MAX_PER_PAGE_LOAD) return;

    const o = opts || {};
    const kind = VALID_KINDS.includes(o.kind) ? o.kind : 'other';
    const action = String(o.action || '').slice(0, 200);
    const message = cleanMessage(o.message);

    if (!message && !action) return;
    if (isIgnorable(message, o.stack, o.filename)) return;

    const key = kind + '|' + action + '|' + message;
    if (seen.has(key)) return;
    seen.add(key);

    reporting = true;
    sentCount += 1;

    const client = await getClient();
    if (!client || typeof client.rpc !== 'function') return;

    await client.rpc('report_client_error', {
      p_kind: kind,
      p_page: window.location ? window.location.pathname : '',
      p_action: action,
      p_message: message,
      p_code: o.code ? String(o.code).slice(0, 50) : null,
      p_title: o.title ? String(o.title).slice(0, 200) : null,
      p_user_agent: (typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '').slice(0, 300),
      p_sentry_event_id: null, // Sentry যোগ হলে (ধাপ ৮) এখানে বসবে
    });
  } catch (_) {
    // রিপোর্টারের নিজের এরর কখনো বাইরে যাবে না
  } finally {
    reporting = false;
  }
}

// ---------- গ্লোবাল হ্যান্ডলার ----------
export function initErrorReporter() {
  try {
    if (typeof window === 'undefined' || initialized) return;
    initialized = true;

    window.SFReportError = reportError;

    window.addEventListener('error', (e) => {
      try {
        // ছবি/স্ক্রিপ্ট লোডের resource error বাদ, শুধু JS রানটাইম এরর
        if (e && e.target && e.target !== window) return;
        reportError({
          kind: 'js_crash',
          action: 'window.onerror',
          message: (e && e.message) || (e && e.error && e.error.message) || '',
          stack: e && e.error && e.error.stack,
          filename: e && e.filename,
        });
      } catch (_) {}
    });

    window.addEventListener('unhandledrejection', (e) => {
      try {
        const r = e && e.reason;
        const message = r && typeof r === 'object' ? r.message || '' : String(r || '');
        reportError({
          kind: 'js_crash',
          action: 'unhandledrejection',
          message,
          stack: r && r.stack,
        });
      } catch (_) {}
    });
  } catch (_) {}
}