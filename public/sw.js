// ============================================================
// ফাইল: public/sw.js
// ফাংশন: Service Worker — PWA/TWA প্রয়োজনীয়তা পূরণ করে +
//         Push Notification হ্যান্ডলিং + অফলাইন ক্যাশ (Phase 4)
// আপডেট: push event এ 4-tier priority সিস্টেম (urgent/high/
//         normal/low) — প্রতিটার আলাদা vibration pattern ও
//         requireInteraction বিহেভিয়ার। Blood Request/Response
//         urgent priority কিন্তু requireInteraction=false
//         (voluntary action, জোর করে থাকবে না)।
// বাগফিক্স: আগে fetch হ্যান্ডলার নেট ফেইলে খালি ক্যাশ ফেরত দিত (কিছুই না),
//         ফলে ইন্টারনেট থাকা অবস্থাতেও "net::ERR_FAILED" আসত। এখন সঠিক
//         ফলব্যাক (নিচে দেখুন) — কখনো খালি রেসপন্স ফেরত যায় না।
//
// আপডেট (O1+O2, অফলাইন ক্যাশ):
//   ১) স্ট্যাটিক (JS/CSS/ফন্ট/আইকন) → cache-first
//   ২) হোমপেজ (/) → stale-while-revalidate: ক্যাশ থাকলে সাথে সাথে সেটা
//      দেখায় (স্প্লাশ দ্রুত সরে), ব্যাকগ্রাউন্ডে নতুনটা এনে ক্যাশ আপডেট করে
//   ৩) অন্যান্য পাবলিক পেজ → network-first (৪ সেকেন্ড টাইমআউট), না পেলে ক্যাশ
//   ৪) Supabase ছবি (listing-images) → stale-while-revalidate, সর্বোচ্চ ৬০টা
//   ৫) কখনো ক্যাশ নয়: /api/, /admin, /cart, /checkout, /my-, /profile,
//      /reset-password, GET ছাড়া অন্য মেথড, Supabase-এর ডাটাবেস/auth কল
//   ৬) কিছুই না পেলে (প্রথমবার অফলাইনে) → offline.html (O2)
// ============================================================
const CACHE_NAME = "smartfeni-v2";
const IMAGE_CACHE_NAME = "smartfeni-images-v1";
const MAX_IMAGE_CACHE_ITEMS = 60;
const NETWORK_TIMEOUT_MS = 4000;
const OFFLINE_URL = "/offline.html";

// এই পাথের নেভিগেশন কখনো ক্যাশ হবে না বা ক্যাশ থেকে ফেরত যাবে না —
// সংবেদনশীল/ব্যক্তিগত/লেনদেন-সম্পর্কিত পেজ
const NEVER_CACHE_PATH_PREFIXES = [
  "/api/", "/admin", "/cart", "/checkout", "/my-listings", "/my-orders",
  "/my-shop", "/my-club", "/profile", "/reset-password", "/become-a-shop-owner",
];

// হোমপেজের মতো stale-while-revalidate (সাথে সাথে ক্যাশ, ব্যাকগ্রাউন্ডে আপডেট)
const SWR_PATHS = new Set(["/"]);

function isNeverCachePath(pathname) {
  return NEVER_CACHE_PATH_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
}

function isStaticAsset(pathname) {
  return (
    pathname.startsWith("/_astro/") ||
    pathname.startsWith("/fonts/") ||
    /\.(?:js|css|woff2?|ttf|ico)$/.test(pathname)
  );
}

function isSupabaseImage(url) {
  return url.hostname.endsWith(".supabase.co") && url.pathname.includes("/storage/v1/object/public/listing-images/");
}

async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maxItems) return;
  // সবচেয়ে পুরোনো এন্ট্রি (keys[0]) আগে মুছবে
  for (let i = 0; i < keys.length - maxItems; i++) {
    await cache.delete(keys[i]);
  }
}

function timeoutPromise(ms) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms));
}

// cache-first: ক্যাশে থাকলে সরাসরি, নাহলে নেট থেকে এনে ক্যাশে রাখা
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached || Response.error();
  }
}

// stale-while-revalidate: ক্যাশ থাকলে সাথে সাথে সেটা, ব্যাকগ্রাউন্ডে রিফ্রেশ
async function staleWhileRevalidate(request, cacheName = CACHE_NAME) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    networkFetch; // ব্যাকগ্রাউন্ডে চলতে দাও, অপেক্ষা করি না
    return cached;
  }

  const fresh = await networkFetch;
  return fresh || Response.error();
}

// network-first with timeout: আগে নেট (সময়সীমাসহ), না পেলে ক্যাশ, তাও না পেলে offline.html
async function networkFirstWithTimeout(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await Promise.race([fetch(request), timeoutPromise(NETWORK_TIMEOUT_MS)]);
    if (response && response.ok) cache.put(request, response.clone());
    return response;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    const offline = await caches.match(OFFLINE_URL);
    return offline || Response.error();
  }
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  // অফলাইন পেজ আগেই ক্যাশে রাখা, নাহলে প্রথমবার অফলাইনে সেটাও মিস হবে
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.add(OFFLINE_URL).catch(() => {}))
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ---------------- Navigation / Static / Image Fetch Handling ----------------
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POST/PUT/DELETE কখনো ক্যাশ নয়

  const url = new URL(request.url);
  if (url.origin !== self.location.origin && !isSupabaseImage(url)) return; // অন্য কোনো থার্ড-পার্টি ডোমেইন ছোঁয়া হবে না

  // পেজ নেভিগেশন
  if (request.mode === "navigate") {
    if (isNeverCachePath(url.pathname)) return; // ব্রাউজার নিজে হ্যান্ডল করুক
    if (SWR_PATHS.has(url.pathname)) {
      event.respondWith(staleWhileRevalidate(request));
    } else {
      event.respondWith(networkFirstWithTimeout(request));
    }
    return;
  }

  // Supabase এর পাবলিক লিস্টিং ছবি
  if (isSupabaseImage(url)) {
    event.respondWith(
      staleWhileRevalidate(request, IMAGE_CACHE_NAME).then((response) => {
        trimCache(IMAGE_CACHE_NAME, MAX_IMAGE_CACHE_ITEMS);
        return response;
      })
    );
    return;
  }

  // স্ট্যাটিক অ্যাসেট (নিজের ডোমেইনের)
  if (url.origin === self.location.origin && isStaticAsset(url.pathname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // বাকি সব (API, ডাটাবেস কল ইত্যাদি) — সরাসরি নেট, ছোঁয়া হবে না
});

// ============================================================
// PUSH NOTIFICATION HANDLING
// ============================================================

// প্রতিটা ক্যাটাগরির জন্য priority বিহেভিয়ার ম্যাপিং
// (সার্ভার থেকে category না পাঠালেও ডিফল্ট normal ধরে নেওয়া হবে)
const NOTIFICATION_BEHAVIOR = {
  blood_request:   { vibrate: [300, 100, 300, 100, 300], requireInteraction: false },
  blood_response:  { vibrate: [300, 100, 300, 100, 300], requireInteraction: false },
  rider_offer:     { vibrate: [250, 100, 250],            requireInteraction: true  },
  shop_order:      { vibrate: [250, 100, 250],            requireInteraction: true  },
  delivery_hero:   { vibrate: [200, 100, 200],             requireInteraction: false },
  listing_status:  { vibrate: [100],                        requireInteraction: false },
  message:         { vibrate: [100],                        requireInteraction: false },
  promo:           { vibrate: [50],                          requireInteraction: false },
  system:          { vibrate: [100],                        requireInteraction: false },
};

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    // যদি JSON পার্স ফেইল করে, প্লেইন টেক্সট হিসেবে ধরে নেওয়া
    payload = { title: "স্মার্ট ফেনী", body: event.data.text() };
  }

  const category = payload.category || "system";
  const behavior = NOTIFICATION_BEHAVIOR[category] || NOTIFICATION_BEHAVIOR.system;

  const title = payload.title || "স্মার্ট ফেনী";
  const options = {
    body: payload.body || "",
    icon: payload.icon || "/icon-192.png",
    badge: "/icon-192.png",
    image: payload.image_url || undefined, // বড় ছবি দেখাতে (promo/blood request)
    data: {
      action_url: payload.action_url || "/",
      notification_id: payload.notification_id || null,
    },
    tag: category, // একই ক্যাটাগরির নোটিফিকেশন স্ট্যাক হবে
    renotify: true,
    requireInteraction: behavior.requireInteraction,
    vibrate: behavior.vibrate,
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// নোটিফিকেশনে ট্যাপ করলে সরাসরি সেই নির্দিষ্ট মেসেজের ফুল-স্ক্রিন
// ডিটেইল ভিউ খোলা — হোমপেজে গিয়ে আবার বেল আইকনে ক্লিক করার
// দরকার নাই। notification_id থাকলে ?notif= প্যারামিটার যোগ করে
// দেওয়া হচ্ছে, NotificationDrawer.astro এটা পড়ে অটো-ওপেন করবে।
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const notificationId = event.notification.data?.notification_id;
  const actionUrl = event.notification.data?.action_url || "/";

  const targetUrl = notificationId
    ? `${actionUrl.split("?")[0]}?notif=${notificationId}`
    : actionUrl;

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      // অ্যাপ ইতিমধ্যে খোলা থাকলে সেই ট্যাবেই নেভিগেট করা, নতুন ট্যাব না খুলে
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      // অ্যাপ খোলা না থাকলে নতুন উইন্ডোতে খোলা
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});