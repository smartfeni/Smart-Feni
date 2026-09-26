// ============================================================
// ফাইল: src/lib/push.js
// ফাংশন: Push Notification পারমিশন চাওয়া, subscribe করা এবং
//         সাবস্ক্রিপশন সার্ভারে পাঠানো — Browser (Web Push/VAPID)
//         এবং Native Android App (FCM) দুটোই সাপোর্ট করে।
//
// আপডেট (নেটিভ পার্মিশন প্রজেক্ট): isNativeApp() চেক করে
//         native app এ থাকলে @capacitor/push-notifications দিয়ে
//         FCM token নিয়ে subscribe করবে (platform: 'android'),
//         browser এ থাকলে আগের VAPID flow অপরিবর্তিত (platform: 'web')।
//
// আপডেট (নোটিফিকেশন লাইফসাইকেল): initNativePushLifecycle() —
//         অ্যাপে (Android) প্রতিটা পেজ লোডে native-bridge.js থেকে চলে:
//         ১) লগইন থাকলে (ও ফোনে অনুমতি দেওয়া থাকলে) বর্তমান FCM টোকেন
//            বর্তমান ইউজারের নামে সার্ভারে সিঙ্ক (একই ইউজারের জন্য ২৪ ঘণ্টায় একবার)
//            → ইউজার বদলালে/টোকেন বদলালে ঠিক থাকে
//         ২) লগআউটে ফোনের FCM টোকেন মুছে ফেলা (unregister) → আগের ইউজারের
//            নোটিফিকেশন আর এই ফোনে আসে না
//         ৩) লগআউটে offline ক্যাশ পরিষ্কার (O7) — শেয়ার্ড ফোনে আগের
//            ইউজারের সংরক্ষিত পেজ/ছবি পরের ইউজারের কাছে থেকে না যায়
//
// ব্যবহার (অন্য কম্পোনেন্ট থেকে, আগের মতোই অপরিবর্তিত):
//   import { subscribeToPush, getPushPermissionState, isPushSupported } from '../../lib/push.js';
//   const result = await subscribeToPush();
// ============================================================

import { supabase } from './supabase.js';
import { isNativeApp } from './native-bridge.js';

const NATIVE_PUSH_GRANTED_KEY = 'smartfeni_push_granted';

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
  if (isNativeApp()) {
    return localStorage.getItem(NATIVE_PUSH_GRANTED_KEY) === '1' ? 'granted' : 'default';
  }
  if (!('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// app এ (native) সবসময় সাপোর্টেড ধরা হয় (Capacitor plugin এর মাধ্যমে);
// browser এ পুরনো ফিচার-চেক অপরিবর্তিত
export function isPushSupported() {
  if (isNativeApp()) return true;
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

// ------------------ Native (Android app / FCM) ------------------
async function subscribeNative() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { success: false, error: 'নোটিফিকেশন অন করতে আগে লগইন করুন' };
  }

  const { PushNotifications } = await import('@capacitor/push-notifications');

  let permStatus = await PushNotifications.checkPermissions();
  if (permStatus.receive !== 'granted') {
    permStatus = await PushNotifications.requestPermissions();
  }
  if (permStatus.receive !== 'granted') {
    return { success: false, error: 'পারমিশন দেওয়া হয়নি', permission: 'denied' };
  }

  return new Promise((resolve) => {
    PushNotifications.addListener('registration', async (token) => {
      try {
        const ua = navigator.userAgent;
        const response = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            accessToken: session.access_token,
            platform: 'android',
            fcm_token: token.value,
            device_label: 'Android App',
          }),
        });

        const result = await response.json();

        if (!response.ok) {
          resolve({ success: false, error: result.error || 'সাবস্ক্রিপশন সেভ করতে ব্যর্থ' });
          return;
        }

        localStorage.setItem(NATIVE_PUSH_GRANTED_KEY, '1');
        resolve({ success: true });
      } catch (err) {
        resolve({ success: false, error: String(err) });
      }
    });

    PushNotifications.addListener('registrationError', (err) => {
      resolve({ success: false, error: 'FCM রেজিস্ট্রেশন ব্যর্থ: ' + JSON.stringify(err) });
    });

    PushNotifications.register();
  });
}

// ------------------ Web (Browser / VAPID) ------------------
async function subscribeWeb() {
  if (!isPushSupported()) {
    return { success: false, error: 'এই ব্রাউজার পুশ নোটিফিকেশন সাপোর্ট করে না' };
  }

  const vapidPublicKey = window.__SMARTFENI_VAPID_KEY;
  if (!vapidPublicKey) {
    return { success: false, error: 'VAPID কী কনফিগার করা নেই' };
  }

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { success: false, error: 'নোটিফিকেশন অন করতে আগে লগইন করুন' };
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { success: false, error: 'পারমিশন দেওয়া হয়নি', permission };
  }

  try {
    const registration = await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });
    }

    const subJson = subscription.toJSON();

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
        platform: 'web',
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

// ------------------ মূল এন্ট্রি পয়েন্ট ------------------
export async function subscribeToPush() {
  if (isNativeApp()) {
    return subscribeNative();
  }
  return subscribeWeb();
}

// ------------------ Native লাইফসাইকেল (লগইন / লগআউট / টোকেন রিফ্রেশ) ------------------
// সমস্যা যেটা ঠিক করে: "অনুমতি দেওয়া আছে" ফ্ল্যাগ (smartfeni_push_granted) ফোনে একবারই
// সেভ থাকে, ইউজারের নামে না। তাই লগআউট করে অন্য কেউ লগইন করলে নতুন ইউজারের সাবস্ক্রিপশন
// তৈরি হতো না, আর টোকেন আগের ইউজারের নামে থেকে যেত (আগের ইউজারের নোটিফিকেশন আসতে থাকত)।
const SYNC_KEY = 'smartfeni_push_last_sync'; // মান: "<userId>:<সময়>"
const SYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

let lifecycleStarted = false;
let currentSession = null;
let registrationListenerAdded = false;

async function syncNativeToken(session) {
  try {
    if (!session?.user?.id) return;

    // একই ইউজারের জন্য ২৪ ঘণ্টার মধ্যে আবার সিঙ্ক নয়; ইউজার বদলালে সাথে সাথে সিঙ্ক
    const [lastUserId, lastTime] = (localStorage.getItem(SYNC_KEY) || '').split(':');
    if (lastUserId === session.user.id && Date.now() - Number(lastTime) < SYNC_INTERVAL_MS) return;

    const { PushNotifications } = await import('@capacitor/push-notifications');

    // ফোনের সেটিংসে অনুমতি না থাকলে কিছু করি না (অনুমতি চাওয়া প্রম্পটের কাজ)
    const permStatus = await PushNotifications.checkPermissions();
    if (permStatus.receive !== 'granted') return;

    if (!registrationListenerAdded) {
      registrationListenerAdded = true;
      await PushNotifications.addListener('registration', async (token) => {
        const activeSession = currentSession;
        if (!activeSession?.user?.id) return;
        try {
          const response = await fetch('/api/push/subscribe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              accessToken: activeSession.access_token,
              platform: 'android',
              fcm_token: token.value,
              device_label: 'Android App',
            }),
          });
          // সফল হলেই সময় সেভ — ব্যর্থ হলে পরের পেজ লোডে আবার চেষ্টা হবে
          if (response.ok) {
            localStorage.setItem(SYNC_KEY, `${activeSession.user.id}:${Date.now()}`);
          }
        } catch (err) {
          // নেটওয়ার্ক সমস্যা — পরের পেজ লোডে আবার চেষ্টা
        }
      });
    }

    await PushNotifications.register();
  } catch (err) {
    // সিঙ্ক ফেইল করলে অ্যাপ স্বাভাবিক চলবে
  }
}

// O7: লগআউটে ক্যাশ করা পেজ/ছবি মুছে ফেলা — শেয়ার্ড ফোনে আগের ইউজারের
// সংরক্ষিত (অফলাইন) তথ্য পরের ইউজারের কাছে থেকে না যায়। sw.js এর
// CACHE_NAME/IMAGE_CACHE_NAME এর সাথে নাম মিলিয়ে রাখা জরুরি (ভার্সন
// বদলালে দুই জায়গাতেই বদলাতে হবে)।
async function clearOfflineCachesOnLogout() {
  try {
    if (typeof caches === 'undefined') return;
    await Promise.all([
      caches.delete('smartfeni-v2'),
      caches.delete('smartfeni-images-v1'),
    ]);
  } catch (err) {
    // ক্যাশ মুছতে না পারলেও লগআউট স্বাভাবিকভাবে সম্পন্ন হবে
  }
}

async function handleNativeSignedOut() {
  try {
    localStorage.removeItem(SYNC_KEY);
    const { PushNotifications } = await import('@capacitor/push-notifications');
    // ফোনের FCM টোকেন মুছে ফেলা — আগের ইউজারের নোটিফিকেশন আর আসবে না;
    // সার্ভারের পুরোনো রেকর্ড send.ts নিজেই মুছে দেবে (মরা টোকেন ধরে)
    if (typeof PushNotifications.unregister === 'function') {
      await PushNotifications.unregister();
    }
  } catch (err) {
    // ফেইল করলে পরের লগইনে টোকেন নতুন ইউজারের নামে সরে যাবে
  }

  clearOfflineCachesOnLogout(); // এটার সফলতা/ব্যর্থতা লগআউটের বাকি ধাপকে প্রভাবিত করবে না
}

export function initNativePushLifecycle() {
  if (!isNativeApp() || lifecycleStarted) return;
  lifecycleStarted = true;

  supabase.auth.onAuthStateChange((event, session) => {
    currentSession = session;

    // setTimeout: onAuthStateChange এর ভেতরে সরাসরি async কাজ না করাই নিরাপদ (supabase-js এর পরামর্শ)
    if (event === 'SIGNED_OUT') {
      setTimeout(handleNativeSignedOut, 0);
      return;
    }
    if (session && (event === 'INITIAL_SESSION' || event === 'SIGNED_IN')) {
      setTimeout(() => syncNativeToken(session), 0);
    }
  });
}
