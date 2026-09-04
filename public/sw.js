// ============================================================
// ফাইল: public/sw.js
// ফাংশন: Service Worker — PWA/TWA প্রয়োজনীয়তা পূরণ করে +
//         এখন Push Notification হ্যান্ডলিং যোগ করা হলো
// আপডেট: push event listener + notificationclick listener
//         যোগ করা হলো (Phase 4 — Push Notification infra)
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

// সার্ভার থেকে push মেসেজ এলে এই ইভেন্ট ট্রিগার হয়
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch (e) {
    // যদি JSON পার্স ফেইল করে, প্লেইন টেক্সট হিসেবে ধরে নেওয়া
    payload = { title: "স্মার্ট ফেনী", body: event.data.text() };
  }

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
    tag: payload.category || "general", // একই ক্যাটাগরির নোটিফিকেশন স্ট্যাক হবে
    renotify: true,
    requireInteraction: payload.high_priority === true, // blood_request এর মতো জরুরি নোটিফিকেশনে ইউজার বন্ধ না করা পর্যন্ত থাকবে
    vibrate: payload.high_priority === true ? [200, 100, 200, 100, 200] : [100],
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
