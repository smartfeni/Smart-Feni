// ============================================================
// ফাইল: public/sw.js
// ফাংশন: Service Worker — PWA/TWA প্রয়োজনীয়তা পূরণ করে +
//         Push Notification হ্যান্ডলিং
// আপডেট: push event এ 4-tier priority সিস্টেম (urgent/high/
//         normal/low) — প্রতিটার আলাদা vibration pattern ও
//         requireInteraction বিহেভিয়ার। Blood Request/Response
//         urgent priority কিন্তু requireInteraction=false
//         (voluntary action, জোর করে থাকবে না)।
// ============================================================

const CACHE_NAME = "smartfeni-v1";
const OFFLINE_URL = "/";

self.addEventListener("install", (event) => {
  self.skipWaiting();
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

self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(OFFLINE_URL))
    );
  }
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

// নোটিফিকেশনে ট্যাপ করলে সংশ্লিষ্ট পেজে নিয়ে যাওয়া
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.action_url || "/";

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
