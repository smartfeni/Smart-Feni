// path: src/lib/proAlert.js
// ============================================================
// Smart Feni Pro — অ্যাপ খোলা অবস্থায় জরুরি নোটিফিকেশনের রিংটোন (ফোরগ্রাউন্ড)
// কেন: অ্যাপ খোলা থাকলে Android সিস্টেম নোটিফিকেশন (ও তার চ্যানেলের রিংটোন) দেখায় না,
//      তাই ProShell-এর রিয়েলটাইম সাবস্ক্রিপশন থেকে এখানকার playProAlert() ডাকা হয়।
// কী করে: রিংটোন বাজায় (/pro-order-alert.mp3 = pro-assets/order_alert.mp3-এর কপি),
//         ফোন কাঁপায়, ওপরে ব্যানার দেখায় (ট্যাপ করলে ওই পেজে যায় ও নোটিফিকেশন পড়া হয়)।
// কোনটা জরুরি: src/lib/proInbox.js-এর isProAlertNotif() (নতুন অর্ডার/রিকোয়েস্ট + দাম একসেপ্ট)।
// রিংটোন বদলাতে: pro-assets/order_alert.mp3 ও public/pro-order-alert.mp3 দুটোই বদলান।
// ইউজারের/ডাটাবেসের লেখা শুধু textContent দিয়ে বসে।
// ============================================================

import { proUrlFor } from './proInbox.js';

const SOUND_URL = '/pro-order-alert.mp3';
const BANNER_ID = 'sf-pro-alert-banner';
const BANNER_MS = 7000;

let audio = null;
let primed = false;
let hideTimer = null;

function getAudio() {
  if (!audio) {
    audio = new Audio(SOUND_URL);
    audio.preload = 'auto';
  }
  return audio;
}

// WebView অটোপ্লে আটকালে: প্রথম ট্যাচে নিঃশব্দে একবার চালিয়ে "আনলক" করে রাখা
function primeOnFirstTouch() {
  if (primed) return;
  primed = true;
  const unlock = () => {
    document.removeEventListener('pointerdown', unlock, true);
    try {
      const a = getAudio();
      if (!a.paused) return; // রিংটোন ইতিমধ্যে বাজছে, কাটব না
      a.muted = true;
      const p = a.play();
      const done = () => { try { a.pause(); a.currentTime = 0; } catch (_) { /* উপেক্ষা */ } a.muted = false; };
      if (p && p.then) p.then(done).catch(() => { a.muted = false; });
      else done();
    } catch (_) { /* উপেক্ষা */ }
  };
  document.addEventListener('pointerdown', unlock, true);
}

// শুধু Pro অ্যাপে (মেইন সাইট/অ্যাপে কিছুই বসে না)
try {
  if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-pro-app')) primeOnFirstTouch();
} catch (_) { /* উপেক্ষা */ }

function hideBanner() {
  const el = document.getElementById(BANNER_ID);
  if (el) el.style.transform = 'translateY(-160%)';
}

function goTo(row) {
  try {
    const target = proUrlFor(row && row.action_url) || '/pro/notifications';
    const u = new URL(target, window.location.origin);
    if (row && row.id) u.searchParams.set('pn', row.id);
    window.location.href = u.pathname + u.search + u.hash;
  } catch (_) {
    window.location.href = '/pro/notifications';
  }
}

function showBanner(row) {
  let el = document.getElementById(BANNER_ID);
  if (!el) {
    el = document.createElement('button');
    el.id = BANNER_ID;
    el.type = 'button';
    el.setAttribute('role', 'alert');
    Object.assign(el.style, {
      position: 'fixed',
      top: 'calc(8px + env(safe-area-inset-top, 0px))',
      left: '10px',
      right: '10px',
      zIndex: '4001',
      display: 'block',
      textAlign: 'left',
      padding: '12px 14px',
      background: '#1B2A4A',
      color: '#fff',
      border: '0',
      borderBottom: '3px solid #FF6B35',
      borderRadius: '14px',
      boxShadow: '0 8px 24px rgba(15, 23, 42, 0.3)',
      fontSize: '0.92rem',
      fontWeight: '600',
      lineHeight: '1.4',
      fontFamily: 'inherit',
      cursor: 'pointer',
      transform: 'translateY(-160%)',
      transition: 'transform 0.25s ease',
    });
    document.body.appendChild(el);
  }
  el.textContent = '🔔 ' + String((row && row.message) || 'নতুন নোটিফিকেশন');
  el.onclick = () => { hideBanner(); goTo(row); };
  // একটু পরে স্লাইড ইন (প্রথমবার তৈরির পর transition কাজ করার জন্য)
  requestAnimationFrame(() => { el.style.transform = 'translateY(0)'; });
  clearTimeout(hideTimer);
  hideTimer = setTimeout(hideBanner, BANNER_MS);
}

// row = user_notifications-এর নতুন রো (id, message, action_url ...)
export function playProAlert(row) {
  try { showBanner(row); } catch (_) { /* ব্যানার না দেখালেও শব্দ বাজবে */ }
  try { if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]); } catch (_) { /* উপেক্ষা */ }
  try {
    const a = getAudio();
    if (!a.paused) return; // এখনো বাজছে — আবার শুরু নয়, ওভারল্যাপও নয়
    a.muted = false;
    a.currentTime = 0;
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* অটোপ্লে আটকালে ব্যানার ও কাঁপুনি তো আছেই */ });
  } catch (_) { /* উপেক্ষা */ }
}
