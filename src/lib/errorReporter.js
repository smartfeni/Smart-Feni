// src/lib/errorReporter.js
// ইউজার-ফেসিং এরর অটো-রিপোর্টার: public.report_client_error() RPC কল করে।
// ব্যবহার:
//   import { reportError, initErrorReporter } from '../lib/errorReporter.js';
//   reportError({ kind: 'db_block', action: 'profile_save', message: error.message, code: error.code, title: 'প্রোফাইল সেভ ফেইল' });
//   initErrorReporter(); // BaseLayout থেকে একবার (ধাপ ৩)
// আপডেট (ধাপ ৮ Sentry): js_crash ব্রাউজারে Sentry-তেও যায় (sentry.client.config.js);
// ইভেন্ট আইডি app_error_logs.sentry_event_id-এ বসে। Sentry-র নিজস্ব অটো-ক্যাপচার বন্ধ,
// তাই এই ফাইলের ফিল্টার/ডেডুপ/সীমা পেরোনো এরর-ই শুধু Sentry-তে যায়।
// মেসেজ থেকে টোকেন, ইমেইল, ফোন নম্বর ও URL query মুছে ফেলা হয় (ব্যক্তিগত তথ্য লগে জমে না)।
// এই ফাইল কখনো throw করে না।
// ডেপ্লয়-স্কিউ রিকভারি: নতুন ডেপ্লয়ে পুরনো _astro/*.js সরে গেলে লেজি-লোড ফেইল করে।
// তখন (vite:preloadError বা "Failed to fetch dynamically imported module") পেজ একবার
// রিলোড হয়; ৬০ সেকেন্ডের মধ্যে আবার ফেইল করলে, অফলাইনে বা sessionStorage না থাকলে
// রিলোড নয়, স্বাভাবিক রিপোর্ট। সফল রিলোডে এরর রিপোর্ট হয় না।

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
  m = m.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'); // ইমেইল মাস্ক
  m = m.replace(/(?:\+?88)?01[3-9]\d{8}/g, '[phone]'); // বাংলাদেশি ফোন নম্বর মাস্ক
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

// ---------- Sentry (ধাপ ৮): শুধু js_crash; ইভেন্ট আইডি ফেরত দেয় ----------
// window.__sfSentryCapture বসায় sentry.client.config.js (DSN না থাকলে এটা নেই, তখন null)।
// Sentry লাইব্রেরি শুধু প্রথম এররের সময় লোড হয় (পেজ-লোডে কোনো বাড়তি ওজন নেই);
// ৩ সেকেন্ডে না পেলে ছেড়ে দিই, যাতে app_error_logs-এর রিপোর্ট আটকে না যায়।
async function captureToSentry(o, message) {
  try {
    if (typeof window.__sfSentryCapture !== 'function') return null;
    const err = o.error instanceof Error ? o.error : new Error(message);
    const id = await Promise.race([
      window.__sfSentryCapture(err, String(o.action || '').slice(0, 100)),
      new Promise((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return id ? String(id) : null;
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

    const sentryId = kind === 'js_crash' ? await captureToSentry(o, message) : null;

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
      p_sentry_event_id: sentryId,
    });
  } catch (_) {
    // রিপোর্টারের নিজের এরর কখনো বাইরে যাবে না
  } finally {
    reporting = false;
  }
}

// ---------- ডেপ্লয়-স্কিউ রিকভারি ----------
const CHUNK_RELOAD_KEY = 'sf_chunk_reload_at';
const CHUNK_RELOAD_COOLDOWN_MS = 60 * 1000;

function isChunkLoadError(message) {
  return /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading chunk .* failed/i.test(
    String(message || '')
  );
}

// রিলোড শুরু করলে true; গার্ডে আটকালে false (তখন এরর স্বাভাবিকভাবে রিপোর্ট হবে)
function tryChunkReload() {
  try {
    if (typeof window === 'undefined') return false;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;

    let last = 0;
    try {
      last = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    } catch (_) {
      return false; // sessionStorage না পেলে লুপের ঝুঁকি, তাই রিলোড নয়
    }

    const now = Date.now();
    if (last && now - last < CHUNK_RELOAD_COOLDOWN_MS) return false;

    try {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
    } catch (_) {
      return false;
    }

    window.location.reload();
    return true;
  } catch (_) {
    return false;
  }
}

// ---------- গ্লোবাল হ্যান্ডলার ----------
export function initErrorReporter() {
  try {
    if (typeof window === 'undefined' || initialized) return;
    initialized = true;

    window.SFReportError = reportError;

    // Vite লেজি-লোডের প্রিলোড ফেইল করলে এই ইভেন্ট দেয়; রিলোড শুরু হলে এররটা আর ছোঁড়া হবে না
    window.addEventListener('vite:preloadError', (e) => {
      try {
        if (tryChunkReload() && e && typeof e.preventDefault === 'function') e.preventDefault();
      } catch (_) {}
    });

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
          error: e && e.error,
        });
      } catch (_) {}
    });

    window.addEventListener('unhandledrejection', (e) => {
      try {
        const r = e && e.reason;
        const message = r && typeof r === 'object' ? r.message || '' : String(r || '');
        if (isChunkLoadError(message) && tryChunkReload()) return;
        reportError({
          kind: 'js_crash',
          action: 'unhandledrejection',
          message,
          stack: r && r.stack,
          error: r instanceof Error ? r : null,
        });
      } catch (_) {}
    });
  } catch (_) {}
}
