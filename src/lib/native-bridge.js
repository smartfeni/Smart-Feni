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
