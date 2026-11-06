// src/lib/healthTracker.js
// ============================================================
// ইউজার হেলথ ট্র্যাকার — "আসল ইউজার কী অভিজ্ঞতা পাচ্ছে" মাপে।
//
// কেন: app_error_logs শুধু ধরা-পড়া এরর গোনে। কিন্তু বাংলাদেশের মোবাইল নেটে সবচেয়ে বড় সমস্যা
// হলো পেজ লোডই শেষ না হওয়া (কালো/সাদা স্ক্রিনে আটকে থাকা) — তখন কোনো JS চলে না, তাই কোনো এররও আসে না।
//
// এই ফাইল যা করে:
//  ১) page_ok / page_slow  — সেশনে পেজ ব্যবহারযোগ্য হলো কিনা ও কত সময়ে (প্রতি সেশনে প্রথম লোড + সব ধীর লোড)
//  ২) page_fail            — আগের পেজ লোড শেষ হয়নি (ইউজার ছেড়ে গেছে/অ্যাপ বন্ধ করেছে) — পরের খোলায় ধরা পড়ে
//                            (head-এর inline স্ক্রিপ্ট sf_h_pend রাখে; এই ফাইল রেডি হলে মুছে ফেলে)
//  ৩) request_fail/slow    — নিজের সাইট ও Supabase-এর fetch: নেটওয়ার্ক ফেইল, ৫xx/408/429, ধীর রিকোয়েস্ট;
//                            এবং script/stylesheet লোড ফেইল (ফন্ট, FontAwesome, বান্ডেল)
//  ৪) funnel               — মূল কাজের ফলাফল (অর্ডার, লিস্টিং, সাইনআপ, লগইন, ছবি আপলোড): ok/rejected/fail
//  ৫) user_report          — ইউজারের নিজের "সমস্যা জানান" (window.SFHealth.openReport())
//
// অফলাইন-সেফ: সব ইভেন্ট আগে localStorage কিউতে (sf_h_q, সর্বোচ্চ ৪০); পাঠানো ব্যর্থ হলে ব্যাকঅফে আবার,
// নেট ফিরলে (online ইভেন্ট) বা পেজ লুকালে (visibilitychange) আবার চেষ্টা। সফল হলেই কিউ থেকে মোছে।
// পাঠানো হয় সরাসরি fetch দিয়ে (Supabase JS বান্ডেল লাগে না), RPC: public.log_client_health।
// কোনো ফোন/ইমেইল/টোকেন যায় না — শুধু ডিভাইস আইডি (sf_did), পেজ পাথ (uuid মাস্ক), নেটওয়ার্ক টাইপ।
// এই ফাইল কখনো throw করে না এবং পেজের কাজ আটকায় না।
// নেটিভ অ্যাপে (নতুন AAB): window.Capacitor.Plugins.SFHealth থাকলে ready()/getInfo() ডাকে;
// না থাকলে (পুরনো অ্যাপ) চুপচাপ বাদ।
// ============================================================

const SB_URL = 'https://hedloawcvnbleehnurqd.supabase.co';
const SB_KEY = 'sb_publishable_T58iE-MmcLsM3I2bQ7vofQ_9c6CG3qx'; // পাবলিক (publishable) key
const ENDPOINT = SB_URL + '/rest/v1/rpc/log_client_health';
const WHATSAPP_NUMBER = '8801816355833';

const Q_KEY = 'sf_h_q';
const PEND_KEY = 'sf_h_pend';
const LOCK_KEY = 'sf_h_lock';
const OK_SESSION_KEY = 'sf_h_okd';
const SID_KEY = 'sf_h_sid';
const REPORT_LOG_KEY = 'sf_h_rep';

const SLOW_LOAD_MS = 8000;
const SLOW_REQ_MS = 8000;
const SLOW_UPLOAD_MS = 20000;
const MAX_QUEUE = 40;
const MAX_BATCH = 20;
const MAX_REQ_EVENTS = 12;
const MAX_SLOW_LOADS_PER_SESSION = 3;
const RETRY_DELAYS = [15000, 45000, 120000, 300000, 600000];
const UUID_RE = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

// মূল কাজের ধাপ: [URL প্যাটার্ন, ধাপের নাম]। শুধু POST গোনা হয়।
const FUNNEL = [
  [/\/api\/delivery\/create-request(?:\?|$)/, 'delivery_request'],
  [/\/api\/chat-order(?:\?|$)/, 'ai_order'],
  [/\/api\/upload-image(?:\?|$)/, 'image_upload'],
  [/\/rest\/v1\/orders(?:\?|$)/, 'shop_order'],
  [/\/rest\/v1\/listings(?:\?|$)/, 'listing_post'],
  [/\/rest\/v1\/blood_requests(?:\?|$)/, 'blood_request'],
  [/\/rest\/v1\/serial_requests(?:\?|$)/, 'serial_request'],
  [/\/auth\/v1\/signup(?:\?|$)/, 'signup'],
  [/\/auth\/v1\/token\?grant_type=password/, 'login'],
];

let origFetch = null;
let info = {};
let infoPromise = null;
let flushing = false;
let flushTimer = null;
let retryCount = 0;
let reqEventCount = 0;
let slowLoadCount = 0;
const seenReq = new Set();
const ring = []; // সাম্প্রতিক ইভেন্ট — ইউজারের রিপোর্টের সাথে যায়

// ---------- ছোট হেল্পার ----------
function lsGet(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (_) {} }
function lsDel(k) { try { localStorage.removeItem(k); } catch (_) {} }
function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

function rand() {
  try {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
  } catch (_) {}
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

// analytics.js-এর সাথে একই key (sf_did) — একই ডিভাইস একই আইডি
function deviceId() {
  let d = lsGet('sf_did');
  if (!d) { d = rand(); lsSet('sf_did', d); }
  return String(d).slice(0, 64);
}

function sessionId() {
  let s = ssGet(SID_KEY);
  if (!s) { s = rand().slice(0, 12); ssSet(SID_KEY, s); }
  return s;
}

function platform() {
  try {
    if (document.documentElement.hasAttribute('data-pro-app')) return 'pro_app';
    if (window.Capacitor && typeof window.Capacitor.isNativePlatform === 'function' && window.Capacitor.isNativePlatform()) return 'android_app';
  } catch (_) {}
  return 'web';
}

function isNative() { return platform() !== 'web'; }

function netNow() {
  const out = {};
  try {
    if (navigator.onLine === false) { out.net_type = 'offline'; return out; }
    const c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (c) {
      if (c.effectiveType) out.net_type = String(c.effectiveType);
      if (typeof c.rtt === 'number') out.rtt_ms = c.rtt;
      if (typeof c.downlink === 'number') out.downlink_mbps = c.downlink;
    }
  } catch (_) {}
  return out;
}

function parseUA() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const m = ua.match(/Android\s([\d.]+);\s*([^;)]*?)(?:\sBuild|[;)])/);
  const w = ua.match(/Chrome\/(\d+)/);
  const model = m && m[2] ? m[2].trim() : '';
  return {
    os_version: m ? m[1] : null,
    device_model: model && model !== 'K' ? model : null,
    webview_version: w ? w[1] : null,
  };
}

// ডিভাইসের তথ্য (মডেল/OS/WebView/অ্যাপ ভার্সন) — একবার, ব্যাকগ্রাউন্ডে। ফেইল করলে যা আছে তাই।
function loadInfo() {
  if (infoPromise) return infoPromise;
  infoPromise = (async () => {
    const out = parseUA();
    try {
      const h = navigator.userAgentData;
      if (h && h.getHighEntropyValues) {
        const v = await Promise.race([h.getHighEntropyValues(['model', 'platformVersion']), timeout(1000)]);
        if (v && v.model) out.device_model = v.model;
        if (v && v.platformVersion) out.os_version = v.platformVersion;
      }
    } catch (_) {}
    try {
      const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SFHealth;
      if (P && typeof P.getInfo === 'function') {
        const n = await Promise.race([P.getInfo(), timeout(1500)]);
        if (n) {
          if (n.model) out.device_model = String(n.model);
          if (n.os) out.os_version = String(n.os);
          if (n.webview) out.webview_version = String(n.webview);
          if (n.appVersion) out.app_version = String(n.appVersion);
          out.native = {
            conn: n.conn || null,
            private_dns: n.privateDns || null,
            auto_time: typeof n.autoTime === 'number' ? n.autoTime : null,
            data_saver: typeof n.dataSaver === 'number' ? n.dataSaver : null,
          };
        }
      }
    } catch (_) {}
    try {
      if (isNative() && !out.app_version) {
        const { App } = await import('@capacitor/app');
        const a = await Promise.race([App.getInfo(), timeout(1500)]);
        if (a && a.version) out.app_version = a.version + (a.build ? '+' + a.build : '');
      }
    } catch (_) {}
    info = out;
    return out;
  })();
  return infoPromise;
}

// ---------- কিউ ----------
function readQ() {
  try {
    const raw = lsGet(Q_KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a : [];
  } catch (_) { return []; }
}
function writeQ(q) { lsSet(Q_KEY, JSON.stringify(q)); }

function sanitizePath(u, any) {
  try {
    const x = new URL(u, window.location.href);
    const own = x.origin === window.location.origin;
    const sb = /\.supabase\.co$/.test(x.hostname);
    if (!own && !sb && !any) return '';
    let p = x.pathname.replace(UUID_RE, ':id').replace(/\/\d{4,}/g, '/:n');
    if (sb) {
      const seg = p.split('/').filter(Boolean);
      const keep = seg[0] === 'storage' ? 4 : (seg[0] === 'rest' && seg[2] === 'rpc' ? 4 : 3);
      return 'sb/' + seg.slice(0, keep).join('/');
    }
    return (own ? '' : x.hostname) + p;
  } catch (_) { return ''; }
}

function enqueue(event, extra) {
  try {
    const e = Object.assign(
      { event, device_id: deviceId(), session_id: sessionId(), platform: platform(), page: window.location.pathname },
      netNow(),
      extra || {}
    );
    e.detail = Object.assign({}, e.detail);
    e._t = Date.now();

    ring.push({ event, page: e.page, at: e._t, d: e.detail.path || e.detail.step || null });
    if (ring.length > 8) ring.shift();

    const q = readQ();
    q.push(e);
    while (q.length > MAX_QUEUE) q.shift();
    writeQ(q);
    scheduleFlush(2500);
  } catch (_) {}
}

function scheduleFlush(ms) {
  try {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flush(false); }, ms);
  } catch (_) {}
}

function scheduleRetry() {
  retryCount += 1;
  if (retryCount > RETRY_DELAYS.length) return; // এই পেজ-লোডে আর নয়; পরের লোড/online ইভেন্টে আবার
  scheduleFlush(RETRY_DELAYS[retryCount - 1]);
}

async function flush(urgent) {
  if (flushing) return;
  try {
    if (navigator.onLine === false) return;
    const q = readQ();
    if (!q.length) return;

    // দুই ট্যাবে একসাথে একই কিউ পাঠানো এড়াতে সহজ লক
    const lock = Number(lsGet(LOCK_KEY)) || 0;
    if (Date.now() - lock < 20000) { scheduleFlush(8000); return; }
    lsSet(LOCK_KEY, String(Date.now()));
  } catch (_) { return; }

  flushing = true;
  try {
    await Promise.race([loadInfo(), timeout(urgent ? 300 : 2500)]).catch(() => {});
    const batch = readQ().slice(0, MAX_BATCH);
    if (!batch.length) return;
    const now = Date.now();
    const payload = batch.map((e) => {
      const o = Object.assign({}, e);
      o.detail = Object.assign({}, e.detail);
      const age = Math.round((now - (e._t || now)) / 1000);
      if (age > 60) o.detail.delay_s = age; // দেরিতে পৌঁছানো ইভেন্ট চেনার জন্য
      if (info.native && !o.detail.native) o.detail.native = info.native;
      delete o._t;
      if (!o.device_model && info.device_model) o.device_model = info.device_model;
      if (!o.os_version && info.os_version) o.os_version = info.os_version;
      if (!o.webview_version && info.webview_version) o.webview_version = info.webview_version;
      if (!o.app_version && info.app_version) o.app_version = info.app_version;
      return o;
    });

    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => { try { if (ctrl) ctrl.abort(); } catch (_) {} }, 15000);
    let ok = false;
    try {
      const f = origFetch || window.fetch.bind(window);
      const res = await f(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: SB_KEY },
        body: JSON.stringify({ p_events: payload }),
        keepalive: !!urgent,
        signal: ctrl ? ctrl.signal : undefined,
      });
      ok = !!(res && res.ok);
    } catch (_) {
      ok = false;
    } finally {
      clearTimeout(timer);
    }

    if (ok) {
      const sent = new Set(batch.map((e) => e._t + '|' + e.event));
      writeQ(readQ().filter((e) => !sent.has(e._t + '|' + e.event)));
      retryCount = 0;
      if (readQ().length) scheduleFlush(1500);
    } else {
      scheduleRetry();
    }
  } catch (_) {
    scheduleRetry();
  } finally {
    lsDel(LOCK_KEY);
    flushing = false;
  }
}

// ---------- রিকোয়েস্ট পর্যবেক্ষণ ----------
function funnelStep(url, method) {
  if (method !== 'POST') return null;
  for (let i = 0; i < FUNNEL.length; i++) {
    if (FUNNEL[i][0].test(url)) return FUNNEL[i][1];
  }
  return null;
}

function reqEvent(event, path, detail) {
  try {
    if (!path || reqEventCount >= MAX_REQ_EVENTS) return;
    const key = event + '|' + path + '|' + (detail && detail.status);
    if (seenReq.has(key)) return;
    seenReq.add(key);
    reqEventCount += 1;
    enqueue(event, { detail: Object.assign({ path }, detail) });
  } catch (_) {}
}

function onResponse(url, method, res, ms) {
  const st = res.status;
  const path = sanitizePath(url, false);
  if (!path) return;
  const rounded = Math.round(ms);
  const step = funnelStep(url, method);
  if (step) {
    enqueue('funnel', { detail: { step, result: st < 400 ? 'ok' : (st < 500 ? 'rejected' : 'fail'), status: st, ms: rounded } });
  }
  if (st >= 500 || st === 408 || st === 429) {
    reqEvent('request_fail', path, { status: st, method, ms: rounded });
  } else if (ms > (method === 'GET' ? SLOW_REQ_MS : SLOW_UPLOAD_MS)) {
    reqEvent('request_slow', path, { status: st, method, ms: rounded });
  }
}

function onNetError(url, method, err, ms) {
  if (err && err.name === 'AbortError') return;
  const path = sanitizePath(url, false);
  if (!path) return;
  const rounded = Math.round(ms);
  const step = funnelStep(url, method);
  if (step) enqueue('funnel', { detail: { step, result: 'fail', status: 0, ms: rounded } });
  reqEvent('request_fail', path, {
    status: 0,
    method,
    ms: rounded,
    offline: navigator.onLine === false,
    err: String((err && err.message) || '').slice(0, 80),
  });
}

function installFetchObserver() {
  try {
    if (window.__sfHealthFetch || typeof window.fetch !== 'function') return;
    window.__sfHealthFetch = true;
    origFetch = window.fetch.bind(window);
    window.fetch = function (input, init) {
      let url = '';
      let method = 'GET';
      try {
        url = typeof input === 'string' ? input : (input && input.url) || String(input);
        method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
      } catch (_) {}
      const t0 = performance.now();
      const p = origFetch(input, init);
      try {
        if (url.indexOf('log_client_health') === -1 && url.indexOf('report_client_error') === -1) {
          p.then(
            (res) => { try { onResponse(url, method, res, performance.now() - t0); } catch (_) {} },
            (err) => { try { onNetError(url, method, err, performance.now() - t0); } catch (_) {} }
          );
        }
      } catch (_) {}
      return p;
    };
  } catch (_) {}
}

function installResourceObserver() {
  try {
    window.addEventListener('error', (e) => {
      try {
        const t = e && e.target;
        if (!t || t === window || !t.tagName) return;
        const tag = String(t.tagName).toUpperCase();
        if (tag !== 'SCRIPT' && tag !== 'LINK') return;
        const path = sanitizePath(t.src || t.href || '', true);
        reqEvent('request_fail', path, { type: 'resource', tag, status: 0, offline: navigator.onLine === false });
      } catch (_) {}
    }, true);
  } catch (_) {}
}

// ---------- আগের অসম্পূর্ণ লোড ----------
function reportPreviousUnfinished() {
  try {
    const raw = window.__sfPrevPend;
    if (!raw) return;
    const prev = JSON.parse(raw);
    if (!prev || !prev.t) return;
    const end = prev.e || null; // pagehide পেলে ইউজার নিজে ছেড়ে গেছে; না পেলে প্রসেস মরেছে (অ্যাপ বন্ধ)
    const stayedMs = end ? end - prev.t : null;
    if (end && stayedMs < 4000) return; // দ্রুত ছেড়ে যাওয়া — সমস্যা ধরছি না
    if (!end && Date.now() - prev.t < 4000) return;
    const extra = {
      page: prev.p || '/',
      detail: { killed: !end, stayed_s: stayedMs == null ? null : Math.round(stayedMs / 1000), prev_net: prev.n || null },
    };
    if (prev.n) extra.net_type = prev.n;
    if (typeof prev.r === 'number') extra.rtt_ms = prev.r;
    enqueue('page_fail', extra);
  } catch (_) {}
}

// ---------- নেটিভ ----------
function nativeCall(name, arg) {
  try {
    const P = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SFHealth;
    if (P && typeof P[name] === 'function') {
      const r = P[name](arg || {});
      if (r && typeof r.catch === 'function') r.catch(() => {});
    }
  } catch (_) {}
}

// ---------- ইউজারের "সমস্যা জানান" ----------
const TOPICS = ['অ্যাপ/সাইট খুলছে না', 'ধীর বা আটকে যায়', 'বাটন/ফর্ম কাজ করছে না', 'অন্য সমস্যা'];

function toast(msg, type) {
  try { if (typeof window.showToast === 'function') window.showToast(msg, type || 'success', 3500); } catch (_) {}
}

function reportAllowed() {
  try {
    const now = Date.now();
    const arr = (JSON.parse(lsGet(REPORT_LOG_KEY) || '[]') || []).filter((t) => now - t < 3600000);
    if (arr.length >= 3) return false;
    arr.push(now);
    lsSet(REPORT_LOG_KEY, JSON.stringify(arr));
    return true;
  } catch (_) { return true; }
}

function openReport() {
  try {
    if (document.getElementById('sf-health-report')) return;
    let topic = '';

    const overlay = document.createElement('div');
    overlay.id = 'sf-health-report';
    overlay.setAttribute('style', 'position:fixed;inset:0;z-index:99998;background:rgba(15,23,42,0.5);display:flex;align-items:flex-end;justify-content:center;');

    const card = document.createElement('div');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-label', 'সমস্যা জানান');
    card.setAttribute('style', 'width:100%;max-width:480px;background:#fff;border-radius:22px 22px 0 0;padding:20px 18px calc(18px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(15,23,42,0.25);font-family:inherit;color:#1B2A4A;max-height:92vh;overflow-y:auto;');

    const h = document.createElement('p');
    h.textContent = 'সমস্যা জানান';
    h.setAttribute('style', 'font-size:1.15rem;font-weight:800;margin:0 0 4px;');
    const sub = document.createElement('p');
    sub.textContent = 'কী সমস্যা হচ্ছে? নিচ থেকে বাছুন, চাইলে দুই লাইনে লিখুন। ফোনের নেটওয়ার্ক ও ডিভাইসের তথ্য নিজে থেকেই যাবে (ফোন নম্বর নয়)।';
    sub.setAttribute('style', 'font-size:0.82rem;color:#5A6E85;line-height:1.55;margin:0 0 12px;');

    const chips = document.createElement('div');
    chips.setAttribute('style', 'display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px;');
    const chipEls = [];
    TOPICS.forEach((label) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.setAttribute('style', 'border:1.5px solid #E5EAF0;background:#F8FAFC;color:#1B2A4A;border-radius:20px;padding:8px 13px;font-size:0.82rem;font-weight:700;font-family:inherit;cursor:pointer;');
      b.addEventListener('click', () => {
        topic = label;
        chipEls.forEach((c) => {
          const on = c === b;
          c.style.background = on ? '#FF6B35' : '#F8FAFC';
          c.style.color = on ? '#fff' : '#1B2A4A';
          c.style.borderColor = on ? '#FF6B35' : '#E5EAF0';
        });
      });
      chipEls.push(b);
      chips.appendChild(b);
    });

    const ta = document.createElement('textarea');
    ta.maxLength = 300;
    ta.rows = 3;
    ta.placeholder = 'কী হচ্ছে লিখুন (ঐচ্ছিক)';
    ta.setAttribute('style', 'width:100%;border:1.5px solid #E5EAF0;border-radius:14px;padding:12px;font-size:0.9rem;font-family:inherit;color:#1B2A4A;background:#FBFCFE;resize:none;box-sizing:border-box;margin-bottom:12px;');

    const send = document.createElement('button');
    send.type = 'button';
    send.textContent = 'পাঠান';
    send.setAttribute('style', 'width:100%;min-height:50px;border:none;border-radius:14px;background:#FF6B35;color:#fff;font-size:1rem;font-weight:800;font-family:inherit;cursor:pointer;margin-bottom:10px;');

    const wa = document.createElement('a');
    wa.target = '_blank';
    wa.rel = 'noopener';
    wa.textContent = 'হোয়াটসঅ্যাপে জানান';
    wa.href = 'https://wa.me/' + WHATSAPP_NUMBER + '?text=' + encodeURIComponent('স্মার্ট ফেনী অ্যাপে সমস্যা হচ্ছে: ');
    wa.setAttribute('style', 'display:block;text-align:center;padding:12px;border-radius:14px;border:1.5px solid #D5DCE8;color:#1B2A4A;text-decoration:none;font-weight:700;font-size:0.9rem;margin-bottom:8px;');

    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'বন্ধ করুন';
    close.setAttribute('style', 'width:100%;border:none;background:transparent;color:#8FA0BC;font-size:0.88rem;font-weight:700;font-family:inherit;cursor:pointer;padding:8px;');

    const shut = () => { try { overlay.remove(); } catch (_) {} };
    close.addEventListener('click', shut);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) shut(); });

    send.addEventListener('click', () => {
      try {
        if (!topic && !ta.value.trim()) { toast('একটা বিষয় বাছুন বা লিখুন', 'error'); return; }
        if (!reportAllowed()) { toast('আপনার রিপোর্ট আগেই পৌঁছেছে। কিছুক্ষণ পরে আবার জানাতে পারবেন।', 'error'); return; }
        enqueue('user_report', {
          detail: {
            topic: topic || null,
            note: ta.value.trim().slice(0, 300),
            recent: ring.slice(-6),
            visible: document.visibilityState,
            ua: (navigator.userAgent || '').slice(0, 160),
          },
        });
        const offline = navigator.onLine === false;
        flush(true);
        shut();
        toast(offline ? 'ইন্টারনেট না থাকায় রাখা হয়েছে, নেট এলে নিজে থেকেই যাবে।' : 'ধন্যবাদ! সমস্যাটা আমাদের কাছে পৌঁছে গেছে।', 'success');
      } catch (_) { shut(); }
    });

    card.appendChild(h);
    card.appendChild(sub);
    card.appendChild(chips);
    card.appendChild(ta);
    card.appendChild(send);
    card.appendChild(wa);
    card.appendChild(close);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  } catch (_) {}
}

// ---------- মূল চালু ----------
export function initHealthTracker() {
  try {
    if (typeof window === 'undefined' || window.__sfHealthInit) return;
    window.__sfHealthInit = true;

    // এই মুহূর্তে JS চলছে মানে পেজ ব্যবহারযোগ্য — নেভিগেশন শুরু থেকে কত মিলিসেকেন্ড
    const loadMs = Math.round(performance.now());
    let ttfb = null;
    try {
      const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
      if (nav && nav.responseStart > 0) ttfb = Math.round(nav.responseStart);
    } catch (_) {}

    installFetchObserver();
    installResourceObserver();
    loadInfo();

    // আগের লোড শেষ হয়নি? ধরে রাখো, তারপর এই লোডের "রেডি" চিহ্ন দাও
    reportPreviousUnfinished();
    lsDel(PEND_KEY);
    nativeCall('ready', { ms: loadMs });

    // সফল/ধীর লোড রেকর্ড (প্রতি সেশনে প্রথম লোড সবসময়; ধীর লোড সেশনে সর্বোচ্চ ৩টা)
    const hidden = document.visibilityState === 'hidden' || document.prerendering === true;
    const first = ssGet(OK_SESSION_KEY) !== '1';
    const slow = !hidden && loadMs > SLOW_LOAD_MS;
    const detail = { hidden };
    if (window.__sfSplashFallback) detail.splash_fallback = true;
    if (slow && slowLoadCount < MAX_SLOW_LOADS_PER_SESSION) {
      slowLoadCount += 1;
      ssSet(OK_SESSION_KEY, '1');
      enqueue('page_slow', { load_ms: loadMs, ttfb_ms: ttfb, detail });
    } else if (first) {
      ssSet(OK_SESSION_KEY, '1');
      enqueue('page_ok', { load_ms: loadMs, ttfb_ms: ttfb, detail });
    }

    window.addEventListener('online', () => { retryCount = 0; scheduleFlush(1500); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush(true);
    });

    window.SFHealth = {
      log: (event, d) => enqueue(event, { detail: d || {} }),
      funnel: (step, result, d) => enqueue('funnel', { detail: Object.assign({ step, result: result || 'ok' }, d) }),
      openReport,
      flush: () => flush(true),
    };

    // আগের (নেট না থাকায়) জমে থাকা ইভেন্ট পাঠানোর চেষ্টা
    scheduleFlush(3000);
  } catch (_) {}
}
