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
//   ৪) অফলাইন ব্যানার (O4) — নেট নেই বোঝা গেলে ওপরে পাতলা বার;
//      এটা ওয়েব ও অ্যাপ দুই জায়গাতেই কাজ করে (isNativeApp() গার্ড ছাড়া)
//   ৫) অফলাইন write গার্ড (O6) — অফলাইনে POST/PUT/PATCH/DELETE (পোস্ট,
//      লাইক, চ্যাট, চেকআউট) fetch()-এর স্তরেই আটকে বন্ধুত্বপূর্ণ বার্তা
//      দেখায়, প্রতিটা পেজ/বাটন আলাদা করে ছুঁতে হয় না
//   ৬) Deep link (D3) — smartfeni.com এর লিংকে ট্যাপ করলে (WhatsApp/SMS/
//      Facebook থেকে) সরাসরি অ্যাপের সঠিক পেজে যাওয়া। অ্যাপ চালু থাকা
//      অবস্থায় (appUrlOpen) ও বন্ধ অবস্থা থেকে খোলা হলে (getLaunchUrl)
//      দুটোই ধরে। assetlinks.json ইতিমধ্যে সাইটে আছে (D1)।
//   ৭) ড্যাশবোর্ড রিডাইরেক্ট — অ্যাপ চালুর পর (শুধু হোম থেকে, শুধু প্রতি
//      অ্যাপ সেশনে একবার) get_my_active_work() এর redirect দেখে: রাইডারের
//      চলমান জব থাকলে হিরো পেজে, শপ মালিক/মডারেটরের পেন্ডিং অর্ডার থাকলে
//      /my-shop এ পাঠায়। নোটিফিকেশনে ট্যাপ বা লিংক থেকে খোলা হলে করে না।
//      splash সরানোর আগে সর্বোচ্চ ১.২ সেকেন্ড অপেক্ষা করে (হোমের ঝলক এড়াতে)।
//   ৮) Back বাটন এখন ফ্লোটিং অ্যাক্টিভিটি বারের বটম শিটও বন্ধ করে।
//   ৯) রেফার সিস্টেম — অ্যাপ প্রথমবার খুললে Google Play Install Referrer থেকে
//      রেফার কোড (ref_XXXXXXXX) পড়ে নেটিভ Preferences-এ রাখে (sf_pending_ref),
//      আর ডিভাইস আইডি (Android ID) দেয়। সাইন আপের সময় AuthModal এগুলো
//      apply_referral() এ পাঠাবে। নেটিভ অংশ: InstallReferrerPlugin.java।
// ============================================================

import { Capacitor, registerPlugin } from '@capacitor/core';

export function isNativeApp() {
  return Capacitor.isNativePlatform();
}

// ---------------- Referral: Install Referrer + Device ID ----------------
// রেফার লিংক (smartfeni.com/r/<কোড>) Play Store-এ খোলে "&referrer=ref_<কোড>" সহ।
// অ্যাপ ইনস্টল হয়ে প্রথমবার খুললে Play Install Referrer API সেই মান দেয়।
// কোডটা Preferences-এ (sf_pending_ref) থাকে — সাইন আপ শেষে apply করে মুছে ফেলা হয়।
// প্লাগিন না থাকলে (পুরোনো অ্যাপ ভার্সন) বা ওয়েবসাইটে সব ফাংশন চুপচাপ null দেয়।
const InstallReferrer = registerPlugin('InstallReferrer');

const REF_PENDING_KEY = 'sf_pending_ref';
const REF_CHECKED_KEY = 'sf_ref_checked_v1';
const REFERRER_TIMEOUT_MS = 4000;
const DEVICE_ID_TIMEOUT_MS = 3000;

let referrerCapturePromise = null;
let cachedDeviceId = null;

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

// "ref_ABCD2345" বা "utm_source=...&ref_ABCD2345" থেকে ৮ অক্ষরের কোড বের করে
export function parseReferralCode(referrer) {
  try {
    if (!referrer) return null;
    let text = String(referrer);
    try {
      text = decodeURIComponent(text);
    } catch (err) {
      // ডিকোড না হলে যেমন আছে তেমনই খোঁজা হবে
    }
    const match = text.match(/(?:^|[&?])ref_([A-Za-z0-9]{8})(?![A-Za-z0-9])/);
    return match ? match[1].toUpperCase() : null;
  } catch (err) {
    return null;
  }
}

async function doCaptureInstallReferrer() {
  try {
    if (!isNativeApp()) return;

    const { Preferences } = await import('@capacitor/preferences');
    const checked = await Preferences.get({ key: REF_CHECKED_KEY });
    if (checked.value === '1') return; // চূড়ান্ত উত্তর আগেই পাওয়া গেছে

    const result = await withTimeout(InstallReferrer.getInstallReferrer(), REFERRER_TIMEOUT_MS);
    const status = result?.status;

    if (status === 'ok') {
      const code = parseReferralCode(result.referrer);
      if (code) await Preferences.set({ key: REF_PENDING_KEY, value: code });
      await Preferences.set({ key: REF_CHECKED_KEY, value: '1' });
    } else if (status === 'unsupported') {
      await Preferences.set({ key: REF_CHECKED_KEY, value: '1' });
    }
    // 'unavailable' / 'error' হলে ফ্ল্যাগ বসাই না — পরের পেজ/অ্যাপ খোলায় আবার চেষ্টা হবে
  } catch (err) {
    // প্লাগিন নেই / টাইমআউট — অ্যাপ স্বাভাবিক চলবে, রেফার কাউন্ট হবে না
  }
}

// প্রতি পেজে একবারের বেশি চলে না (একই promise ফেরত দেয়)
export function captureInstallReferrer() {
  if (!referrerCapturePromise) referrerCapturePromise = doCaptureInstallReferrer();
  return referrerCapturePromise;
}

// সাইন আপের সময় ডাকা হয় — চেক শেষ না হলে অপেক্ষা করে, তারপর কোড পড়ে
export async function getPendingReferralCode() {
  try {
    if (!isNativeApp()) return null;
    await captureInstallReferrer();
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: REF_PENDING_KEY });
    return value || null;
  } catch (err) {
    return null;
  }
}

export async function clearPendingReferral() {
  try {
    if (!isNativeApp()) return;
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: REF_PENDING_KEY });
  } catch (err) {
    // মুছতে না পারলেও সার্ভার একই ইউজারের দ্বিতীয় রেফার গ্রহণ করে না
  }
}

// "১ ফোন = ১ রেফার" চেকের জন্য ফোনের আইডি; না পেলে null (তখন রেফার কাউন্ট হবে না)
export async function getNativeDeviceId() {
  try {
    if (!isNativeApp()) return null;
    if (cachedDeviceId) return cachedDeviceId;
    const result = await withTimeout(InstallReferrer.getDeviceId(), DEVICE_ID_TIMEOUT_MS);
    cachedDeviceId = result?.id || null;
    return cachedDeviceId;
  } catch (err) {
    return null;
  }
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
  '.sf-act-sheet:not([hidden])',
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

  // রেফার: প্রথমবার খুললে Play Install Referrer থেকে কোড ধরে রাখে (পরে আর কিছু করে না)
  captureInstallReferrer();

  const { App } = await import('@capacitor/app');

  // Deep link (cold start): অ্যাপ বন্ধ অবস্থা থেকে লিংক দিয়ে খোলা হলে —
  // splash সরানোর আগেই চেক করা হয়, যাতে হোমপেজ এক মুহূর্তের জন্যও না দেখিয়ে
  // সরাসরি লিংকের পেজে যাওয়া যায়
  await handleDeepLink(await App.getLaunchUrl().catch(() => null));

  // ড্যাশবোর্ড রিডাইরেক্ট (শপ মালিক/রাইডারের কাজ থাকলে) — splash সরানোর আগে,
  // যাতে হোম পেজের ঝলক না দেখা যায়
  await maybeRedirectToDashboard();

  hideSplashWhenReady();
  initNotificationHandlers();
  initOfflineBanner();
  initOfflineWriteGuard();

  // Deep link (অ্যাপ চালু থাকা অবস্থায়): WhatsApp/SMS/Facebook থেকে লিংকে ট্যাপ
  App.addListener('appUrlOpen', (data) => {
    handleDeepLink(data);
  });

  App.addListener('backButton', ({ canGoBack }) => {
    if (closeTopOverlay()) return;

    if (canGoBack) {
      window.history.back();
    } else {
      App.minimizeApp();
    }
  });
}

// ---------------- Dashboard Redirect on App Open ----------------
// রাইডারের চলমান জব / শপ মালিকের পেন্ডিং অর্ডার থাকলে অ্যাপ খুলতেই ওই ড্যাশবোর্ডে।
// সিদ্ধান্ত নেয় ডাটাবেস (get_my_active_work → redirect), এখানে শুধু নেভিগেট।
// নিয়ম: প্রতি অ্যাপ সেশনে একবার (sessionStorage; অ্যাপ প্রসেস মারা গেলে রিসেট),
// শুধু হোম ('/') থেকে, নোটিফিকেশন ট্যাপ/ডিপ লিংক থাকলে করে না।
// replace() ব্যবহার — যাতে ড্যাশবোর্ড থেকে Back চাপলে হোমে ফিরে আবার
// রিডাইরেক্টের চক্র না হয় (Back তখন অ্যাপ minimize করে)।
const LAUNCH_REDIRECT_FLAG = 'sf_launch_redirect_done';
const LAUNCH_REDIRECT_TIMEOUT_MS = 1200;
let navigatingAway = false;

async function maybeRedirectToDashboard() {
  try {
    if (!isNativeApp() || navigatingAway) return;
    if (sessionStorage.getItem(LAUNCH_REDIRECT_FLAG) === '1') return;
    sessionStorage.setItem(LAUNCH_REDIRECT_FLAG, '1'); // এই সেশনে আর নয়

    if (window.location.pathname !== '/' || window.location.search) return;

    const lookup = (async () => {
      const { supabase } = await import('./supabase.js');
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return null;

      const { data, error } = await supabase.rpc('get_my_active_work');
      if (error) return null;
      return data?.redirect || null;
    })().catch(() => null);

    // splash বেশি সময় আটকে না রাখতে সর্বোচ্চ ১.২ সেকেন্ড অপেক্ষা
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), LAUNCH_REDIRECT_TIMEOUT_MS));
    const target = await Promise.race([lookup, timeout]);

    if (typeof target !== 'string' || !target.startsWith('/') || target.startsWith('//')) return;
    if (navigatingAway || window.location.pathname !== '/') return; // ইতিমধ্যে অন্য পেজে যাচ্ছে

    window.location.replace(target);
  } catch (err) {
    // ফেইল করলে অ্যাপ স্বাভাবিক হোম খুলবে
  }
}

// ---------------- Deep Link Handling (D3) ----------------
// getLaunchUrl() এর রেজাল্ট { url } আকারে, appUrlOpen ইভেন্টও { url } আকারে —
// তাই দুই জায়গা থেকেই একই ফাংশনে পাঠানো যায়।
function handleDeepLink(data) {
  try {
    if (!data?.url) return;

    const url = new URL(data.url);
    if (url.hostname !== 'smartfeni.com' && url.hostname !== 'www.smartfeni.com') return;
    if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return;

    const target = url.pathname + url.search;
    if (target === window.location.pathname + window.location.search) return; // একই পেজ, কিছু করার নেই

    navigatingAway = true; // ড্যাশবোর্ড রিডাইরেক্ট যেন লিংকের পেজ নষ্ট না করে
    window.location.href = target;
  } catch (err) {
    // ভুল/অসম্পূর্ণ লিংক হলে অ্যাপ স্বাভাবিক (হোমপেজ) খুলবে
  }
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

    navigatingAway = true; // ড্যাশবোর্ড রিডাইরেক্ট যেন ট্যাপের পেজ নষ্ট না করে
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

// ---------------- Offline Banner ----------------
// নেট না থাকলে পেজের উপরে একটা পাতলা বার দেখায়। ওয়েব ও অ্যাপ দুই জায়গাতেই
// কাজ করে (isNativeApp() গার্ড ইচ্ছাকৃতভাবে নেই)। কাস্টমারের ভাষায় লেখা —
// "ক্যাশ", "সার্ভার" এর মতো টেকনিক্যাল শব্দ ব্যবহার করা হয়নি।
const OFFLINE_BANNER_ID = 'sf-offline-banner';

function ensureOfflineBannerEl() {
  let el = document.getElementById(OFFLINE_BANNER_ID);
  if (el) return el;

  el = document.createElement('div');
  el.id = OFFLINE_BANNER_ID;
  el.setAttribute('role', 'status');
  el.textContent = '📡 আপনি অফলাইনে আছেন — সংরক্ষিত তথ্য দেখানো হচ্ছে';
  Object.assign(el.style, {
    position: 'fixed',
    top: '0',
    left: '0',
    right: '0',
    zIndex: '4000', // ড্রয়ার/মডালের চেয়েও ওপরে, সবসময় দেখা যাবে
    padding: 'calc(8px + env(safe-area-inset-top, 0px)) 16px 8px',
    background: '#FFF1E6',
    color: '#7A4A1E',
    fontSize: '0.85rem',
    fontWeight: '600',
    textAlign: 'center',
    borderBottom: '1px solid #F3D9BE',
    transform: 'translateY(-100%)',
    transition: 'transform 0.25s ease',
  });
  document.body.appendChild(el);
  return el;
}

function setOfflineBannerVisible(visible) {
  const el = ensureOfflineBannerEl();
  el.style.transform = visible ? 'translateY(0)' : 'translateY(-100%)';
}

function initOfflineBanner() {
  try {
    setOfflineBannerVisible(!navigator.onLine);
    window.addEventListener('online', () => setOfflineBannerVisible(false));
    window.addEventListener('offline', () => setOfflineBannerVisible(true));
  } catch (err) {
    // ব্যানার দেখানো না গেলেও সাইট স্বাভাবিক চলবে
  }
}

// ---------------- Offline Write Guard ----------------
// অফলাইনে "লেখা"-জাতীয় রিকোয়েস্ট (পোস্ট, লাইক, চ্যাট, চেকআউট, স্ট্যাটাস
// বদল ইত্যাদি) fetch()-এর স্তরেই আটকে দেয়, যাতে নেটওয়ার্ক টাইমআউটের জন্য
// অপেক্ষা করতে না হয় এবং ইউজার সাথে সাথে বুঝতে পারে কেন কাজ হলো না।
// শুধু GET ছাড়া অন্য মেথড, আর নিজের সাইট/Supabase-এর দিকে যাওয়া রিকোয়েস্ট
// আটকায় — অন্য কোনো থার্ড-পার্টি (ফন্ট, স্ক্রিপ্ট) কল অপ্রভাবিত।
// একবারই চালু হয় — দ্বিতীয়বার initOfflineWriteGuard() ডাকা হলেও fetch
// দ্বিতীয়বার wrap হবে না।
let offlineWriteGuardInstalled = false;

function isWriteGuardedUrl(url) {
  try {
    const target = new URL(url, window.location.origin);
    return target.origin === window.location.origin || target.hostname.endsWith('.supabase.co');
  } catch (err) {
    return false;
  }
}

function initOfflineWriteGuard() {
  if (offlineWriteGuardInstalled) return;
  offlineWriteGuardInstalled = true;

  try {
    const originalFetch = window.fetch.bind(window);

    window.fetch = function guardedFetch(input, init) {
      const method = (init?.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
      const url = typeof input === 'string' ? input : input?.url || '';

      if (method !== 'GET' && !navigator.onLine && isWriteGuardedUrl(url)) {
        try {
          window.showToast?.('ইন্টারনেট নেই — একটু পরে আবার চেষ্টা করুন', 'error');
        } catch (err) {
          // টোস্ট দেখানো না গেলেও রিকোয়েস্ট আটকাতে সমস্যা নেই
        }
        return Promise.reject(new Error('অফলাইন — রিকোয়েস্ট পাঠানো হয়নি'));
      }

      return originalFetch(input, init);
    };
  } catch (err) {
    // fetch wrap করা না গেলে সাইট স্বাভাবিক চলবে, শুধু guard ছাড়া
  }
}
