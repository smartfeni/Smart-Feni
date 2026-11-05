// path: src/lib/proUpdate.js
// ============================================================
// Smart Feni Pro — অ্যাপ আপডেট চেক (ধাপ ঘ)
// উৎস: ডাটাবেসের app_releases (শুধু RPC get_latest_app_release('pro') দিয়ে পড়া)।
// ইনস্টল করা ভার্সন = @capacitor/app getInfo().build (= versionCode = GitHub Actions run নম্বর)।
// নতুন রিলিজের version_code বেশি হলে ডায়ালগ: "আপডেট করুন" (ডাউনলোড লিংক বাইরের ব্রাউজারে খোলে)
// ও "পরে" (২৪ ঘণ্টা চুপ)। ইনস্টল করা ভার্সন min_version_code-এর নিচে হলে "পরে" থাকে না।
// শুধু Pro অ্যাপে চলে (isProApp); ওয়েব ও মেইন অ্যাপে কিছুই হয় না। সব কিছু try/catch-এ।
// প্রতি নতুন Pro বিল্ডের পর app_releases-এ সারি বসাতে হবে (version_code = run নম্বর)।
// ডাটাবেসের লেখা শুধু textContent দিয়ে বসে।
// ============================================================

import { supabase } from './supabase.js';
import { isProApp } from './proApp.js';

const SESSION_KEY = 'sf_pro_update_checked';
const SNOOZE_KEY = 'sf_pro_update_snooze';
const SNOOZE_MS = 24 * 60 * 60 * 1000;
const DIALOG_ID = 'sf-pro-update';

function safeHttpsUrl(u) {
  try {
    const x = new URL(String(u));
    return x.protocol === 'https:' ? x.href : null;
  } catch (_) {
    return null;
  }
}

// সর্বশেষ সক্রিয় রিলিজ (নেই বা ব্যর্থ হলে null)
export async function fetchLatestRelease(appId = 'pro') {
  try {
    const { data, error } = await supabase.rpc('get_latest_app_release', { p_app_id: appId });
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return data[0];
  } catch (_) {
    return null;
  }
}

async function installedBuild() {
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    const n = parseInt(info && info.build, 10);
    return Number.isFinite(n) ? n : null;
  } catch (_) {
    return null;
  }
}

function readLs(key) {
  try { return localStorage.getItem(key); } catch (_) { return null; }
}
function writeLs(key, val) {
  try { localStorage.setItem(key, val); } catch (_) { /* উপেক্ষা */ }
}
function readSs(key) {
  try { return sessionStorage.getItem(key); } catch (_) { return null; }
}
function writeSs(key, val) {
  try { sessionStorage.setItem(key, val); } catch (_) { /* উপেক্ষা */ }
}

function closeDialog() {
  const el = document.getElementById(DIALOG_ID);
  if (el) el.remove();
}

function showUpdateDialog(rel, forced) {
  if (document.getElementById(DIALOG_ID)) return;
  const url = safeHttpsUrl(rel.download_url);
  if (!url) return;

  const ov = document.createElement('div');
  ov.id = DIALOG_ID;
  ov.className = 'psu-ov';
  ov.setAttribute('role', 'dialog');
  ov.setAttribute('aria-label', 'নতুন ভার্সন');
  Object.assign(ov.style, {
    position: 'fixed', inset: '0', zIndex: '4100', background: 'rgba(27, 42, 74, 0.55)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
  });

  const sheet = document.createElement('div');
  Object.assign(sheet.style, {
    width: '100%', maxWidth: '520px', background: '#fff', color: '#1B2A4A',
    borderRadius: '24px 24px 0 0', boxSizing: 'border-box',
    padding: '20px 20px calc(20px + env(safe-area-inset-bottom, 0px))',
    fontFamily: "'Hind Siliguri', system-ui, sans-serif",
    boxShadow: '0 -6px 24px rgba(27, 42, 74, 0.18)',
  });

  const badge = document.createElement('div');
  badge.textContent = forced ? '⚠️ আপডেট জরুরি' : '🎉 নতুন ভার্সন';
  Object.assign(badge.style, {
    display: 'inline-block', padding: '4px 12px', borderRadius: '999px', background: '#FFF6F1',
    color: '#FF6B35', fontSize: '13px', fontWeight: '700', marginBottom: '8px',
  });

  const title = document.createElement('h2');
  title.textContent = forced ? 'চালিয়ে যেতে অ্যাপ আপডেট করুন' : 'Smart Feni Pro-র নতুন ভার্সন এসেছে';
  Object.assign(title.style, { margin: '0 0 4px', fontSize: '20px', fontWeight: '700', lineHeight: '1.35' });

  const ver = document.createElement('p');
  ver.textContent = 'ভার্সন ' + String(rel.version_name || rel.version_code);
  Object.assign(ver.style, { margin: '0 0 10px', fontSize: '14px', color: '#5B6B86' });

  sheet.appendChild(badge);
  sheet.appendChild(title);
  sheet.appendChild(ver);

  if (rel.notes) {
    const notes = document.createElement('div');
    notes.textContent = String(rel.notes);
    Object.assign(notes.style, {
      whiteSpace: 'pre-line', fontSize: '15px', lineHeight: '1.55', background: '#F8FAFC',
      borderRadius: '14px', padding: '12px 14px', margin: '0 0 14px', maxHeight: '32vh', overflowY: 'auto',
    });
    sheet.appendChild(notes);
  }

  const go = document.createElement('a');
  go.href = url;
  go.target = '_blank';
  go.rel = 'noopener';
  go.textContent = 'আপডেট করুন';
  Object.assign(go.style, {
    display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '52px', borderRadius: '14px',
    background: '#FF6B35', color: '#fff', fontSize: '16px', fontWeight: '700', textDecoration: 'none',
  });
  go.addEventListener('click', () => {
    // ডাউনলোডে গেলে আবার সাথে সাথে ডায়ালগ নয়
    if (!forced) {
      writeLs(SNOOZE_KEY, String(Date.now()));
      setTimeout(closeDialog, 400);
    }
  });
  sheet.appendChild(go);

  if (forced) {
    const hint = document.createElement('p');
    hint.textContent = 'ইনস্টল শেষে অ্যাপ আবার খুলুন। পুরোনো অ্যাপের উপরেই ইনস্টল করুন, ডেটা মুছবে না।';
    Object.assign(hint.style, { margin: '10px 2px 0', fontSize: '13px', color: '#5B6B86', lineHeight: '1.5' });
    sheet.appendChild(hint);
  } else {
    const later = document.createElement('button');
    later.type = 'button';
    later.textContent = 'পরে';
    Object.assign(later.style, {
      width: '100%', minHeight: '46px', marginTop: '10px', borderRadius: '14px', border: '1.5px solid #D5DCE8',
      background: '#fff', color: '#1B2A4A', fontSize: '15px', fontWeight: '600', fontFamily: 'inherit', cursor: 'pointer',
    });
    later.addEventListener('click', () => {
      writeLs(SNOOZE_KEY, String(Date.now()));
      closeDialog();
    });
    sheet.appendChild(later);
  }

  ov.appendChild(sheet);
  document.body.appendChild(ov);
}

// অ্যাপ খোলার কিছুক্ষণ পর ProShell থেকে ডাকা হয়
export async function checkProUpdate() {
  try {
    if (!(await isProApp())) return;
    if (readSs(SESSION_KEY) === '1') return; // এই অ্যাপ সেশনে ইতিমধ্যে চেক/দেখানো হয়েছে

    const [build, rel] = await Promise.all([installedBuild(), fetchLatestRelease('pro')]);
    if (build === null || !rel) return;

    const latest = Number(rel.version_code);
    if (!Number.isFinite(latest) || latest <= build) {
      writeSs(SESSION_KEY, '1');
      return;
    }

    const minCode = Number(rel.min_version_code) || 0;
    const forced = build < minCode;

    if (!forced) {
      const last = Number(readLs(SNOOZE_KEY)) || 0;
      writeSs(SESSION_KEY, '1');
      if (Date.now() - last < SNOOZE_MS) return; // ২৪ ঘণ্টার মধ্যে আগেই দেখানো হয়েছে
    }
    // জোর করা আপডেটে সেশন ফ্ল্যাগ বসে না: পেজ বদলালেও আবার দেখায়

    showUpdateDialog(rel, forced);
  } catch (_) {
    // ফেইল করলে অ্যাপ স্বাভাবিক চলবে
  }
}
