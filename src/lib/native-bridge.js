// ============================================================
// Native Bridge — Capacitor (Android app) ও Browser এর মধ্যে
// platform detect করে সঠিক API (native plugin বা web API) ব্যবহার করে।
// Website এ (browser) এই ফাইল থাকলেও কোনো আচরণ বদলাবে না —
// শুধু app এর ভেতরে চললেই native path নেয়।
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
// Android এর back বাটন চাপলে: WebView history তে আগের পেজ থাকলে
// সেখানে ফিরে যাবে; না থাকলে (হোমপেজে থাকলে) app বন্ধ না করে
// minimize করবে (Android home এ চলে যাবে)।
export async function initBackButtonHandler() {
  if (!isNativeApp()) return;

  const { App } = await import('@capacitor/app');

  App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack) {
      window.history.back();
    } else {
      App.minimizeApp();
    }
  });
}
