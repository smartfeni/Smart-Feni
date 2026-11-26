// ============================================================
// consoleRiders.js — নতুন অ্যাডমিন অ্যাপের রাইডার/ড্রাইভার পেজের শেয়ার্ড অংশ (ধাপ ৬)
// আইডি কার্ড/কাগজ: প্রাইভেট বাকেট rider-verification → ১ ঘণ্টার signed URL
// (পুরনো টেস্ট ডেটায় পুরো URL থাকলে সেটাই ফেরত, পুরনো পেজের মতো)।
// ============================================================
import { supabase } from './supabase.js';

export const VEHICLE_BN = { bike: 'বাইক', cycle: 'সাইকেল', cng: 'সিএনজি', walk: 'হেঁটে', car: 'গাড়ি' };

export async function signedRiderDoc(pathOrUrl) {
  if (!pathOrUrl) return null;
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl.replace(/["'<>\s]/g, '');
  const { data, error } = await supabase.storage.from('rider-verification').createSignedUrl(pathOrUrl, 3600);
  if (error) return null;
  return (data && data.signedUrl) || null;
}

export function publicPhoto(url) {
  return /^https:\/\//.test(url || '') ? String(url).replace(/["'<>\s]/g, '') : null;
}

// পুরো স্ক্রিনে ছবি (একটাই লাইটবক্স, নিজের স্টাইলসহ)
let lb = null;
export function openPhoto(url, alt) {
  if (!url) return;
  if (!lb) {
    lb = document.createElement('div');
    lb.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(10,16,30,.92);display:flex;align-items:center;justify-content:center;';
    const img = document.createElement('img');
    img.style.cssText = 'max-width:94vw;max-height:86vh;border-radius:8px;';
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '✕';
    x.setAttribute('aria-label', 'বন্ধ করুন');
    x.style.cssText = 'position:absolute;top:calc(12px + env(safe-area-inset-top));right:12px;width:44px;height:44px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:18px;cursor:pointer;';
    lb.append(img, x);
    const close = () => { lb.style.display = 'none'; img.src = ''; };
    x.addEventListener('click', close);
    lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && lb && lb.style.display !== 'none') close(); });
    document.body.appendChild(lb);
  }
  const img = lb.querySelector('img');
  img.src = url;
  img.alt = alt || '';
  lb.style.display = 'flex';
}
