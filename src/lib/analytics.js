// ============================================================
// ফাইল: analytics.js
// ফাংশন: কাস্টম ইভেন্ট ট্র্যাকিং — একবার কল করলে GA4 এবং Supabase
//         দুই জায়গাতেই লগ হয়ে যায়
// ব্যবহার: trackEvent('call_button_click', { category: 'home-food', upazila: 'feni-sadar' })
// ============================================================

import { supabase } from './supabase.js';

// এই ব্রাউজার/ডিভাইসের জন্য একবার বানানো নামহীন আইডি (লগইন ছাড়াও গোনা যায়)
function getDeviceId() {
  try {
    if (typeof window === 'undefined') return null;
    let id = localStorage.getItem('sf_did');
    if (!id) {
      id = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
      localStorage.setItem('sf_did', id);
    }
    return id;
  } catch (e) {
    return null;
  }
}

export function trackEvent(eventName, params = {}) {
  // ===== GA4-তে পাঠানো =====
  if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
    window.gtag('event', eventName, params);
  }

  // ===== Supabase events টেবিলে লগ করা =====
  // ফায়ার-অ্যান্ড-ফরগেট — এরর হলেও ইউজার এক্সপেরিয়েন্স ব্লক হবে না
  supabase
    .from('events')
    .insert({
      event_name: eventName,
      upazila: params.upazila || null,
      category: params.category || null,
      meta: params,
      device_id: getDeviceId(),
    })
    .then(({ error }) => {
      if (error) {
        console.error('Analytics event log failed:', error.message);
      }
    });
}