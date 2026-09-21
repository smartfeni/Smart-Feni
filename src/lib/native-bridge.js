// ============================================================
// Native Bridge — Capacitor (Android app) ও Browser এর মধ্যে
// platform detect করে সঠিক API (native plugin বা web API) ব্যবহার করে।
// Website এ (browser) এই ফাইল থাকলেও কোনো আচরণ বদলাবে না —
// শুধু app এর ভেতরে চললেই native path নেয়।
//
// আপডেট: rememberLastUrl() যোগ — অ্যাপে প্রতিটা পেজ খুললে তার URL
// নেটিভ স্টোরেজে (Preferences, key: sf_last_url) সেভ হয়, যাতে ইন্টারনেট/
// সার্ভার সমস্যায় www/error.html এ "আবার চেষ্টা করুন" চাপলে ঠিক ওই
// পেজেই ফেরা যায়।
//
// আপডেট: Android back বাটন এখন আগে খোলা drawer/modal বন্ধ করে
// (notification, category, post-flow, hamburger, auth, chat ইত্যাদি),
// তারপর কিছু খোলা না থাকলে তবেই পেজ পিছনে যায়।
//
// আপডেট: Splash screen (অ্যাপ আইকন) এখন পেজের HTML পার্স হয়ে প্রথম
// ফ্রেম আঁকা হলেই সরে যায় (hideSplashWhenReady) — আগে সব ছবি নামা
// (`load` ইভেন্ট) পর্যন্ত অপেক্ষা করত, তাই ধীর নেটে ১০+ সেকেন্ড লাগত।
// capacitor.config.json এ সর্বোচ্চ ১৫ সেকেন্ডের সেফটি লিমিট আছে।
//
// আপডেট: নোটিফিকেশন (initNotificationHandlers) —
//   ১) Android notification channel তৈরি (ফোনের Settings → Apps → Smart Feni
//      → Notifications এ প্রতিটার আলাদা সুইচ/শব্দ; আইডি send.ts এর সাথে মিলতে হবে)
//   ২) পুশে ট্যাপ করলে সঠিক পেজে যাওয়া (ওয়েবের sw.js notificationclick এর মতোই)
//   ৩) লগইন/লগআউটে FCM টোকেন সিঙ্ক ও মোছা (push.js এর initNativePushLifecycle)
// ============================================================

import { Capacitor } from '@capacitor/core';

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

// ---------------- Location ----------------
// browser এর navigator.geolocation.getCurrentPosition() এর মতোই
// callback signature: (onSuccess, onError, options)
// pos.coords.latitude / pos.coords.longitude একই ফরম্যাটে পাওয়া যাবে।
export async function getCurrentPosition(onSuccess, onError, options = {}) {
  if (isNativeApp()) {
    try {
      const { Geolocation } = await import('@capacitor/geolocation');
      const permStatus = await Geolocation.checkPermissions();
      if (permStatus.location !== 'granted' && permStatus.coarseLocation !== 'granted') {
        const req = await Geolocation.requestPermissions();
        if (req.location !== 'granted' && req.coarseLocation !== 'granted') {
          onError(new Error('Location permission denied'));
          return;
        }
      }
      const pos = await Geolocation.getCurrentPosition({
        enableHighAccuracy: options.enableHighAccuracy ?? true,
        timeout: options.timeout ?? 8000,
      });
      onSuccess(pos);
    } catch (err) {
      onError(err);
    }
    return;
  }

  if (!navigator.geolocation) {
    onError(new Error('Geolocation not supported'));
    return;
  }
  navigator.geolocation.getCurrentPosition(onSuccess, onError, options);
}

// ---------------- Camera / Gallery ----------------
// source: 'camera' | 'gallery'
// রিটার্ন করে একটা File object — compressImage()/uploadChatImage() এ
// সরাসরি ব্যবহার করা যাবে, ঠিক যেমন <input type="file"> থেকে পাওয়া File।
export async function capturePhoto(source = 'camera') {
  if (!isNativeApp()) {
    throw new Error('capturePhoto শুধু native app এ ব্যবহার করুন');
  }

  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');

  const photo = await Camera.getPhoto({
    quality: 85,
    resultType: CameraResultType.Uri,
    source: source === 'gallery' ? CameraSource.Photos : CameraSource.Camera,
  });

  const response = await fetch(photo.webPath);
  const blob = await response.blob();
  const ext = photo.format || 'jpg';
  return new File([blob], `photo-${Date.now()}.${ext}`, {
    type: blob.type || `image/${ext}`,
  });
}

// ---------------- Hardware Back Button ----------------
// Android এর back বাটন চাপলে:
//   ১) কোনো drawer/modal খোলা থাকলে সবচেয়ে উপরেরটা বন্ধ হবে (পেজ পিছনে যাবে না)
//   ২) কিছু খোলা না থাকলে: WebView history তে আগের পেজ থাকলে সেখানে ফিরে যাবে
//   ৩) history ও না থাকলে (হোমপেজে) app বন্ধ না করে minimize করবে

// সাইটের সব drawer/modal এর "খোলা" অবস্থার ক্লাস — .open বা .active
// (নতুন drawer/modal এই নামের নিয়ম মানলে নিজে থেকেই কাজ করবে)
const OPEN_OVERLAY_SELECTOR = [
  '[class*="overlay"].open',
  '[class*="overlay"].active',
  '[class*="-modal"].open',
  '#sf-chat-panel.sf-open',
].join(',');

const CLOSE_BUTTON_SELECTOR = [
  'button[aria-label*="বন্ধ"]',
  'button[aria-label*="close" i]',
  'button[class*="close"]',
  'button[id*="Close"]',
  'button[id*="close"]',
].join(',');

function isVisible(el) {
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden' && el.getClientRects().length > 0;
}

// একাধিক খোলা থাকলে z-index সবচেয়ে বেশি যেটার সেটা; সমান হলে DOM এ যেটা পরে
function getTopOpenOverlay() {
  const open = Array.from(document.querySelectorAll(OPEN_OVERLAY_SELECTOR)).filter(isVisible);
  let top = null;
  let topZ = -Infinity;
  open.forEach((el) => {
    const z = parseInt(window.getComputedStyle(el).zIndex, 10);
    const zIndex = Number.isNaN(z) ? 0 : z;
    if (zIndex >= topZ) {
      top = el;
      topZ = zIndex;
    }
  });
  return top;
}

// drawer/modal এর নিজের close কোড চালানোর জন্য ইউজারের মতোই ক্লিক করে
// (এতে body scroll-lock ইত্যাদি তাদের নিজের নিয়মেই ঠিক হয়)
function closeTopOverlay() {
  const overlay = getTopOpenOverlay();
  if (!overlay) return false;

  const closeBtn = overlay.querySelector(CLOSE_BUTTON_SELECTOR);
  if (closeBtn) {
    closeBtn.click();
    return true;
  }

  const backdrop = overlay.querySelector('[class*="backdrop"]');
  if (backdrop) {
    backdrop.click();
    return true;
  }

  overlay.click();
  return true;
}

export async function initBackButtonHandler() {
  if (!isNativeApp()) return;

  // BaseLayout প্রতিটা পেজ লোডে এই ফাংশন চালায় — তাই শেষ পেজ মনে রাখার কাজও এখানেই
  rememberLastUrl();
  hideSplashWhenReady();
  initNotificationHandlers();

  const { App } = await import('@capacitor/app');

  App.addListener('backButton', ({ canGoBack }) => {
    if (closeTopOverlay()) return;

    if (canGoBack) {
      window.history.back();
    } else {
      App.minimizeApp();
    }
  });
}

// ---------------- Last Visited Page (Error Page Retry) ----------------
// অ্যাপে শেষ যে পেজ খোলা হয়েছিল তার URL নেটিভ স্টোরেজে রাখে।
// www/error.html একই key (sf_last_url) থেকে পড়ে "আবার চেষ্টা করুন" এ ওই পেজে ফেরে।
// নিরাপত্তা: hash বাদ যায়; পাসওয়ার্ড রিসেট বা token/code যুক্ত URL সেভ হয় না।
const LAST_URL_KEY = 'sf_last_url';

async function rememberLastUrl() {
  try {
    if (!isNativeApp()) return;
    if (window.location.origin !== 'https://smartfeni.com') return;

    const { pathname, search } = window.location;
    if (pathname.startsWith('/reset-password') || pathname.startsWith('/api/')) return;
    if (/token|code=/i.test(search)) return;

    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({
      key: LAST_URL_KEY,
      value: window.location.origin + pathname + search,
    });
  } catch (err) {
    // সেভ ফেইল করলে অ্যাপের কিছু যায় আসে না — error.html তখন হোমে ফিরবে
  }
}

// ---------------- Splash Screen ----------------
// অ্যাপ খোলার সময় splash (আইকন) দেখায়; ওয়েবসাইটের পেজ পার্স হয়ে প্রথম
// ফ্রেম আঁকা হলেই সরিয়ে দেয়। ছবি/ফন্ট নামার জন্য অপেক্ষা করে না —
// ওগুলো পেজে ধীরে ধীরে দেখা যাবে (ধীর নেটে splash ১০+ সেকেন্ড আটকে
// থাকা এড়াতে)।
// (সাইট একেবারেই না খুললে capacitor.config.json এর ১৫ সেকেন্ডের লিমিট কাজ করে)
async function hideSplashWhenReady() {
  try {
    if (!isNativeApp()) return;

    const { SplashScreen } = await import('@capacitor/splash-screen');

    let hidden = false;
    const hide = () => {
      if (hidden) return;
      hidden = true;
      // দুইবার requestAnimationFrame: প্রথম পেজ আঁকা হওয়ার পর সরায়, যাতে সাদা ঝলক না আসে
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          SplashScreen.hide({ fadeOutDuration: 200 }).catch(() => {});
        });
      });
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', hide, { once: true });
    } else {
      hide();
    }
  } catch (err) {
    // ফেইল করলে capacitor.config.json এর সেফটি লিমিটে splash নিজে সরে যাবে
  }
}

// ---------------- Notification Channels + Tap Handler ----------------
// চ্যানেল আইডি অবশ্যই src/pages/api/push/send.ts এর CHANNEL_BY_CATEGORY এর সাথে মিলতে হবে।
// ⚠️ চ্যানেল একবার তৈরি হলে শব্দ/গুরুত্ব অ্যাপ আর বদলাতে পারে না (ইউজার বদলায়)।
// বদলাতে হলে নতুন আইডি (_v2) দিন এবং CHANNELS_FLAG এর ভার্সনও বাড়ান।
// importance: 1 min · 2 low · 3 default · 4 high · 5 max
const NOTIF_CHANNELS = [
  { id: 'sf_blood_v1', name: '🩸 জরুরি রক্ত', description: 'রক্তের জরুরি অনুরোধ ও ডোনারের সাড়া', importance: 5, visibility: 1, vibration: true },
  { id: 'sf_rider_v1', name: '🚴 হিরো রিকোয়েস্ট', description: 'নতুন ডেলিভারি/রাইড রিকোয়েস্ট', importance: 4, visibility: 1, vibration: true },
  { id: 'sf_delivery_v1', name: '📦 ডেলিভারি আপডেট', description: 'ডেলিভারির প্রতিটা ধাপের খবর', importance: 4, visibility: 1, vibration: true },
  { id: 'sf_orders_v1', name: '🛍️ অর্ডার', description: 'শপের নতুন অর্ডার ও অর্ডারের অবস্থা', importance: 4, visibility: 1, vibration: true },
  { id: 'sf_message_v1', name: '💬 মেসেজ', description: 'চ্যাট ও সরাসরি মেসেজ', importance: 4, visibility: 1, vibration: true },
  { id: 'sf_updates_v1', name: '📋 লিস্টিং ও আবেদন আপডেট', description: 'লিস্টিং অনুমোদন, আবেদনের ফলাফল, নিরাপত্তা সতর্কতা', importance: 3, visibility: 1, vibration: true },
  { id: 'sf_promo_v1', name: '🎁 অফার', description: 'অফার ও ঘোষণা', importance: 2, visibility: 1, vibration: false },
];

// শুধু অ্যাডমিন/মডারেটরের ফোনে (/admin পেজ খুললে তৈরি হয়)
const ADMIN_CHANNEL = {
  id: 'sf_admin_v1', name: '⚙️ অ্যাডমিন সতর্কতা', description: 'অ্যাডমিন/মডারেটরদের জন্য সাইট সতর্কতা',
  importance: 3, visibility: 1, vibration: true,
};

const CHANNELS_FLAG = 'sf_notif_channels_v1';
const ADMIN_CHANNEL_FLAG = 'sf_notif_admin_channel_v1';

// পুশে ট্যাপ → সঠিক পেজ (ওয়েবের sw.js এর মতো: action_url এর পাথ + ?notif=<id>,
// যাতে নোটিফিকেশন ড্রয়ার ওই পেজে গিয়ে নোটিফিকেশনটা খুলে দেখায়)
function handleNotificationTap(event) {
  try {
    const data = event?.notification?.data || {};
    const rawUrl = data.action_url || '/';
    const url = new URL(rawUrl, window.location.origin);

    // শুধু নিজের সাইটের লিংক
    if (url.origin !== window.location.origin) return;

    const notifId = data.notification_id;
    const target = notifId
      ? `${url.pathname}?notif=${encodeURIComponent(notifId)}`
      : url.pathname + url.search;

    window.location.href = target;
  } catch (err) {
    // ট্যাপ হ্যান্ডলিং ফেইল করলে অ্যাপ যেমন খুলেছে তেমনই থাকবে
  }
}

async function createChannelOnce(PushNotifications, channel) {
  await PushNotifications.createChannel(channel);
}

async function initNotificationHandlers() {
  try {
    if (!isNativeApp()) return;

    const { PushNotifications } = await import('@capacitor/push-notifications');

    // ১) ট্যাপ হ্যান্ডলার — অ্যাপ বন্ধ থাকা অবস্থায় ট্যাপ করে খুললেও ইভেন্টটা
    //    listener বসার সাথে সাথে পৌঁছায়
    PushNotifications.addListener('pushNotificationActionPerformed', handleNotificationTap);

    // ১.৫) লগইন/লগআউটে টোকেন সিঙ্ক (আলাদা try — এটা ফেইল করলে চ্যানেল তৈরি আটকাবে না)
    try {
      const { initNativePushLifecycle } = await import('./push.js');
      initNativePushLifecycle();
    } catch (err) {
      // ফেইল করলে টোকেন সিঙ্ক শুধু প্রম্পটের মাধ্যমেই হবে (আগের মতো)
    }

    // ২) চ্যানেল তৈরি — একবার সফল হলে ফ্ল্যাগ সেভ, তাই প্রতি পেজে আবার নয়
    if (localStorage.getItem(CHANNELS_FLAG) !== 'done') {
      for (const channel of NOTIF_CHANNELS) {
        await createChannelOnce(PushNotifications, channel);
      }
      localStorage.setItem(CHANNELS_FLAG, 'done');
    }

    // ৩) অ্যাডমিন চ্যানেল — শুধু অ্যাডমিন/মডারেটর যখন অ্যাডমিন পেজ খোলে
    window.addEventListener('smartfeni:admin-ready', async () => {
      try {
        if (localStorage.getItem(ADMIN_CHANNEL_FLAG) === 'done') return;
        await createChannelOnce(PushNotifications, ADMIN_CHANNEL);
        localStorage.setItem(ADMIN_CHANNEL_FLAG, 'done');
      } catch (err) {
        // ফেইল করলে অ্যাডমিন নোটিফিকেশন সাধারণ চ্যানেলে আসবে — ভাঙবে না
      }
    });
  } catch (err) {
    // প্লাগইন না থাকলে (পুরোনো অ্যাপ ভার্সন) বা ফেইল করলে চুপচাপ বাদ — নোটিফিকেশন সাধারণ চ্যানেলে আসবে
  }
}
