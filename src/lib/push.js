// ============================================================
// ফাইল: src/lib/push.js
// ফাংশন: ব্রাউজারে Push Notification পারমিশন চাওয়া, subscribe
//         করা এবং সাবস্ক্রিপশন সার্ভারে পাঠানো (Phase 4)
//
// আপডেট: VAPID public key এখন import.meta.env এর বদলে
//         window.__SMARTFENI_VAPID_KEY থেকে পড়া হচ্ছে —
//         কারণ Vercel এ "PUBLIC_" দিয়ে শুরু নাম সেভ করা যাচ্ছিল
//         না, তাই env var নাম রাখা হয়েছে "PUSH_KEY_PUBLIC"
//         (prefix ছাড়া) — কিন্তু Astro/Vite এর নিয়মে
//         import.meta.env দিয়ে ক্লায়েন্ট-সাইডে অ্যাক্সেস করতে
//         "PUBLIC_" প্রিফিক্স আবশ্যক। তাই BaseLayout.astro এর
//         সার্ভার-সাইড ফ্রন্টম্যাটার থেকে ভ্যালুটা পড়ে
//         window global variable হিসেবে পেজে বসানো হয়েছে
//         (GA_MEASUREMENT_ID এর মতো define:vars প্যাটার্নে)।
//
// ব্যবহার (অন্য কম্পোনেন্ট থেকে):
//   import { subscribeToPush, getPushPermissionState } from '../../lib/push.js';
//   const result = await subscribeToPush();
// ============================================================

import { supabase } from './supabase.js';

// VAPID public key (base64url string) কে Uint8Array এ কনভার্ট করা,
// pushManager.subscribe() এর applicationServerKey এর জন্য এই ফরম্যাট লাগে
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// বর্তমান পারমিশন স্ট্যাটাস চেক করার জন্য — 'granted' | 'denied' | 'default'
export function getPushPermissionState() {
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// ব্রাউজার এই ফিচার সাপোর্ট করে কিনা (পুরনো ব্রাউজার/কিছু iOS ভার্সনে সাপোর্ট নাই)
export function isPushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// মূল ফাংশন — permission চাওয়া, subscribe করা, সার্ভারে সেভ করা
export async function subscribeToPush() {
  if (!isPushSupported()) {
    return { success: false, error: 'এই ব্রাউজার পুশ নোটিফিকেশন সাপোর্ট করে না' };
  }

  const vapidPublicKey = window.__SMARTFENI_VAPID_KEY;
  if (!vapidPublicKey) {
    return { success: false, error: 'VAPID কী কনফিগার করা নেই' };
  }

  // ইউজার লগইন করা আছে কিনা চেক
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { success: false, error: 'নোটিফিকেশন অন করতে আগে লগইন করুন' };
  }

  // ব্রাউজারের নেটিভ পারমিশন পপ-আপ (এটা শুধু soft-ask মোডালে "হ্যাঁ" চাপার পরই কল করা উচিত)
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { success: false, error: 'পারমিশন দেওয়া হয়নি', permission };
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    // আগে থেকে subscribe করা থাকলে সেটাই রিইউজ করা, নতুন করে subscribe না করে
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const subJson = subscription.toJSON();

    // ডিভাইস লেবেল অনুমান করা (ডিবাগিং সুবিধার জন্য, ইউজার এটা দেখবে না)
    const ua = navigator.userAgent;
    const deviceLabel = /Android/i.test(ua)
      ? 'Chrome - Android'
      : /iPhone|iPad/i.test(ua)
      ? 'Safari - iOS'
      : 'Browser - Desktop';

    const response = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessToken: session.access_token,
        endpoint: subJson.endpoint,
        keys: subJson.keys,
        device_label: deviceLabel,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return { success: false, error: result.error || 'সাবস্ক্রিপশন সেভ করতে ব্যর্থ' };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}