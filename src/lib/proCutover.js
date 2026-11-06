// path: src/lib/proCutover.js
// ============================================================
// Pro অ্যাপে সম্পূর্ণ সরানো (ধাপ চ) — মেইন অ্যাপ/ব্রাউজারে, একটা সুইচে নিয়ন্ত্রিত
// সুইচ: site_settings.pro_cutover ('on' | 'off'; এখন 'off' — SF বললে চালু হবে)। চালু হলে:
//   ১) মেনু থেকে রোলের আইটেম (শপ/ক্লাব/ক্লিনিক/ডেলিভারি হিরো/অফলাইন/রাইড) লুকায়
//   ২) রোলের পেজ (/my-shop, /my-club, /my-clinic, /delivery-hero, /offline-orders, /ride-hero)
//      খুললে /pro-app?role=... (ডাউনলোড + নির্দেশনা) পেজে পাঠায়; জরুরিতে ?main=1 দিলে পুরনো পেজ খোলে
//   ৩) যাদের রোল আছে কিন্তু Pro অ্যাপ নেই, তাদের একবার "জরুরি নোটিস" মডাল (রোল অনুযায়ী লেখা):
//      "অ্যাপ ডাউনলোড করুন" | "আমি ইনস্টল করেছি" | ✕ — যেকোনো একটায় আর দেখায় না
// Pro অ্যাপের ভেতরে কিছুই করে না। সব কিছু try/catch-এ; ব্যর্থ হলে আগের আচরণ।
// নোটিসের লেখা: টেবিল pro_notice_templates (রোল অনুযায়ী); ইউজারের লেখা textContent-এ বসে।
// ============================================================

import { supabase } from './supabase.js';
import { isProApp } from './proApp.js';

const CACHE_KEY = 'sf_pro_cutover_v1';
const CACHE_MS = 5 * 60 * 1000;

const ROLE_PAGES = [
  ['/my-shop', 'shop'],
  ['/my-club', 'club'],
  ['/my-clinic', 'clinic'],
  ['/delivery-hero', 'rider'],
  ['/offline-orders', 'rider'],
  ['/ride-hero', 'rider'],
];

export async function isProCutoverOn() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (raw) {
      const c = JSON.parse(raw);
      if (c && Date.now() - c.t < CACHE_MS) return c.v === 'on';
    }
  } catch (_) { /* উপেক্ষা */ }
  try {
    const { data } = await supabase.from('site_settings').select('value').eq('key', 'pro_cutover').maybeSingle();
    const v = data && data.value === 'on' ? 'on' : 'off';
    try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ v, t: Date.now() })); } catch (_) { /* উপেক্ষা */ }
    return v === 'on';
  } catch (_) {
    return false;
  }
}

function injectHideCss() {
  if (document.getElementById('sf-cutover-css')) return;
  const st = document.createElement('style');
  st.id = 'sf-cutover-css';
  st.textContent = 'html[data-pro-cutover] #hmShopItem, html[data-pro-cutover] #hmClubItem, html[data-pro-cutover] #hmClinicItem, '
    + 'html[data-pro-cutover] #hmRiderItem, html[data-pro-cutover] #hmOfflineOrderItem, html[data-pro-cutover] #hmRideRiderItem { display: none !important; }'
    + '.sf-pn-ov { position: fixed; inset: 0; z-index: 100000; background: rgba(27,42,74,.62); display: flex; align-items: center; justify-content: center; padding: 16px; font-family: "Hind Siliguri", system-ui, sans-serif; }'
    + '.sf-pn-card { position: relative; width: 100%; max-width: 420px; max-height: 88vh; overflow-y: auto; background: #fff; border-radius: 22px; padding: 22px 18px 18px; box-shadow: 0 12px 40px rgba(0,0,0,.28); color: #1B2A4A; }'
    + '.sf-pn-badge { display: inline-flex; align-items: center; gap: 6px; background: #FFF1EB; color: #D9480F; font-weight: 700; font-size: 13px; padding: 5px 12px; border-radius: 999px; }'
    + '.sf-pn-x { position: absolute; top: 10px; right: 10px; width: 40px; height: 40px; border: 0; background: none; font-size: 20px; color: #5B6B86; cursor: pointer; }'
    + '.sf-pn-sec { margin-top: 14px; background: #F8FAFC; border-radius: 14px; padding: 12px; }'
    + '.sf-pn-sec h3 { margin: 0 0 4px; font-size: 16px; font-weight: 700; }'
    + '.sf-pn-sec p { margin: 0; font-size: 14.5px; line-height: 1.6; color: #33415C; }'
    + '.sf-pn-go { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 50px; margin-top: 16px; border: 0; border-radius: 14px; background: #FF6B35; color: #fff; font-weight: 700; font-size: 16px; font-family: inherit; text-decoration: none; cursor: pointer; }'
    + '.sf-pn-done { display: flex; align-items: center; justify-content: center; width: 100%; min-height: 46px; margin-top: 10px; border: 1.5px solid #D5DCE8; border-radius: 14px; background: #fff; color: #1B2A4A; font-weight: 600; font-size: 15px; font-family: inherit; cursor: pointer; }';
  document.head.appendChild(st);
}

async function markSeen(action) {
  try { await supabase.rpc('mark_pro_notice_seen', { p_action: action }); } catch (_) { /* উপেক্ষা */ }
}

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function showNotice(items) {
  if (document.getElementById('sf-pro-notice')) return;
  const ov = mk('div', 'sf-pn-ov');
  ov.id = 'sf-pro-notice';
  const card = mk('div', 'sf-pn-card');
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-modal', 'true');

  const close = (action) => { markSeen(action); ov.remove(); };

  const x = mk('button', 'sf-pn-x', '✕');
  x.type = 'button';
  x.setAttribute('aria-label', 'বন্ধ করুন');
  x.addEventListener('click', () => close('closed'));
  card.appendChild(x);
  card.appendChild(mk('span', 'sf-pn-badge', '⚠️ জরুরি নোটিস'));

  items.forEach((it) => {
    const sec = mk('div', 'sf-pn-sec');
    sec.appendChild(mk('h3', null, it.title));
    sec.appendChild(mk('p', null, it.message));
    card.appendChild(sec);
  });

  const roles = items.map((it) => it.role).join(',');
  const go = mk('a', 'sf-pn-go', 'অ্যাপ ডাউনলোড করুন');
  go.href = '/pro-app?role=' + encodeURIComponent(roles);
  go.addEventListener('click', () => { markSeen('download'); });
  card.appendChild(go);

  const done = mk('button', 'sf-pn-done', 'আমি ইনস্টল করেছি');
  done.type = 'button';
  done.addEventListener('click', () => close('installed'));
  card.appendChild(done);

  ov.appendChild(card);
  document.body.appendChild(ov);
}

async function maybeShowNotice() {
  try {
    if (location.pathname.indexOf('/pro-app') === 0) return;
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data, error } = await supabase.rpc('get_my_pro_notice');
    if (error || !data) return;
    if (data.seen || data.installed) return;
    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) return;
    showNotice(items);
  } catch (_) { /* উপেক্ষা */ }
}

export async function initProCutover() {
  try {
    if (await isProApp()) return;
    if (!(await isProCutoverOn())) return;

    document.documentElement.setAttribute('data-pro-cutover', '1');
    injectHideCss();

    const path = location.pathname;
    const hit = ROLE_PAGES.find(([p]) => path === p || path.indexOf(p + '/') === 0);
    if (hit && new URLSearchParams(location.search).get('main') !== '1') {
      location.replace('/pro-app?role=' + hit[1]);
      return;
    }

    setTimeout(maybeShowNotice, 1500);
  } catch (_) { /* ব্যর্থ হলে আগের আচরণ */ }
}
