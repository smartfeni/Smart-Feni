// ============================================================
// Smart Feni Pro — "এটা কি Pro অ্যাপ?" চেনা ও নেভিগেশন
// চেনার উপায়: নেটিভ অ্যাপে @capacitor/app-এর getInfo().id == com.smartfeni.pro
// (Pro বিল্ডে applicationId বদলানো হয়)। ওয়েব ব্রাউজার ও মেইন অ্যাপে সবসময় false।
// ফল cache করা; চেনা গেলে <html data-pro-app="1"> বসে (পরে CSS/আলাদা করার কাজে লাগবে)।
// applyProNav(): Pro অ্যাপে নিচের নেভের "হোম" ও ওপরের লোগো /pro-তে যায়
// (আগে / এ, অর্থাৎ মেইন অ্যাপের হোমপেজে নিয়ে যেত)।
// সব কিছু try/catch-এ, ব্যর্থ হলে চুপচাপ আগের আচরণ।
// ============================================================

import { Capacitor } from '@capacitor/core';

export const PRO_APP_ID = 'com.smartfeni.pro';
export const PRO_HOME = '/pro';
export const PRO_FLAG_KEY = 'sf_pro_app';

// মেইন সাইটের পেজ -> Pro অ্যাপের পেজ (নোটিফিকেশনে ট্যাপ ইত্যাদিতে)।
// পাথের প্রিফিক্স মেলে; বাকি অংশ (/সাব-পাথ) অপরিবর্তিত; query আলাদা, কলারই রাখে।
const PRO_PATH_MAP = [
  ['/delivery-hero', '/pro/hero/delivery'],
  ['/ride-hero', '/pro/hero/ride'],
  ['/offline-orders', '/pro/hero/offline'],
  ['/my-club', '/pro/club'],
  ['/my-clinic', '/pro/clinic'],
  ['/my-shop', '/pro/online-shop'],
];

export function proPath(pathname) {
  const p = String(pathname || '');
  for (const [from, to] of PRO_PATH_MAP) {
    if (p === from || p.indexOf(from + '/') === 0) return to + p.slice(from.length);
  }
  return p;
}

let proPromise = null;

export function isProApp() {
  if (proPromise) return proPromise;
  proPromise = (async () => {
    try {
      if (!Capacitor.isNativePlatform()) return false;
      const { App } = await import('@capacitor/app');
      const info = await Promise.race([
        App.getInfo(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
      ]);
      const pro = !!info && info.id === PRO_APP_ID;
      if (pro) document.documentElement.setAttribute('data-pro-app', '1');
      else document.documentElement.removeAttribute('data-pro-app');
      // ফ্ল্যাগ মনে রাখা, যাতে পরের পেজ লোডে (head স্ক্রিপ্টে) আঁকার আগেই Pro মোড চালু হয়;
      // নেটিভ কিন্তু Pro নয় (মেইন অ্যাপ) হলে ফ্ল্যাগ মুছে যায়। ব্রাউজারে এই লাইনে আসেই না।
      try {
        if (pro) localStorage.setItem(PRO_FLAG_KEY, '1');
        else localStorage.removeItem(PRO_FLAG_KEY);
      } catch (_) { /* উপেক্ষা */ }
      return pro;
    } catch (_) {
      return false;
    }
  })();
  return proPromise;
}

export async function applyProNav() {
  try {
    if (!(await isProApp())) return false;

    const home = document.getElementById('bnHome');
    if (home) {
      home.setAttribute('href', PRO_HOME);
      home.dataset.path = PRO_HOME;
      const p = window.location.pathname;
      home.classList.toggle('active', p === PRO_HOME || p.indexOf(PRO_HOME + '/') === 0);
    }

    document.querySelectorAll('.logo-center').forEach((a) => a.setAttribute('href', PRO_HOME));
    return true;
  } catch (_) {
    return false;
  }
}
