// Pro অ্যাপ: ডেটা ক্যাশ (stale-while-revalidate)। আগে ক্যাশ দেখাও, পেছনে নতুন ডেটা এনে বদলাও।
// ইউজার আইডি ধরে আলাদা; লগআউটে সব মুছে যায়। শুধু অসংবেদনশীল ডেটার জন্য
// (মেনু/প্রোডাক্ট তালিকা)। অর্ডার স্ট্যাটাস, চ্যাট, ঠিকানা, ফোন, পেমেন্ট ক্যাশ করবে না।
import { supabase } from './supabase.js';

const PREFIX = 'sf_pdc_v1:';
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;

async function uid() {
  try {
    const { data } = await supabase.auth.getSession();
    return data && data.session ? data.session.user.id : null;
  } catch (_) { return null; }
}

export async function readProCache(name) {
  try {
    const u = await uid();
    if (!u) return null;
    const raw = localStorage.getItem(PREFIX + u + ':' + name);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || Date.now() - o.t > MAX_AGE) return null;
    return o.v;
  } catch (_) { return null; }
}

export async function writeProCache(name, value) {
  try {
    const u = await uid();
    if (!u) return;
    localStorage.setItem(PREFIX + u + ':' + name, JSON.stringify({ t: Date.now(), v: value }));
  } catch (_) { /* জায়গা শেষ/ব্লক হলে উপেক্ষা */ }
}

export function clearProCache() {
  try {
    const rm = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(PREFIX) === 0) rm.push(k);
    }
    rm.forEach((k) => localStorage.removeItem(k));
  } catch (_) { /* উপেক্ষা */ }
}

try {
  supabase.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') clearProCache(); });
} catch (_) { /* উপেক্ষা */ }
