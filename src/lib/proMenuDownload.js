// স্থায়ী: মেইন অ্যাপের মেনুতে "Pro অ্যাপ ডাউনলোড করুন" — Pro রোল আছে কিন্তু Pro অ্যাপ ইনস্টল নেই এমন ইউজারের জন্য।
// cutover সুইচের উপর নির্ভর করে না।
import { supabase } from './supabase.js';
import { isProApp } from './proApp.js';

const CACHE_KEY = 'sf_pro_menudl_v1';
const TTL = 2 * 60 * 1000;

function readCache() {
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o && Date.now() - o.t < TTL) return o.v;
  } catch (_) { /* উপেক্ষা */ }
  return null;
}
function writeCache(v) {
  try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ v, t: Date.now() })); } catch (_) { /* উপেক্ষা */ }
}

function apply(v) {
  const el = document.getElementById('hmProDlItem');
  if (!el) return;
  const roles = Array.isArray(v && v.roles) ? v.roles : [];
  if (roles.length > 0 && !v.installed) {
    el.setAttribute('href', '/pro-app?role=' + encodeURIComponent(roles.join(',')));
    el.style.display = 'flex';
  } else {
    el.style.display = 'none';
  }
}

export async function initProMenuDownload() {
  try {
    if (!document.getElementById('hmProDlItem')) return;
    if (await isProApp()) return;
    const cached = readCache();
    if (cached) { apply(cached); return; }
    const { data: sess } = await supabase.auth.getSession();
    if (!sess || !sess.session) return;
    const { data, error } = await supabase.rpc('get_my_pro_notice');
    if (error || !data) return;
    const v = { roles: data.roles || [], installed: !!data.installed };
    writeCache(v);
    apply(v);
  } catch (_) { /* মেনু আইটেম ঐচ্ছিক, কখনো ভাঙবে না */ }
}
