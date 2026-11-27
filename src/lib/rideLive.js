// ============================================================
// লোকাল রাইড — লাইভ লোকেশন (ধাপ ৩, নভে ২০২৬)
// চালক (Pro /pro/local-ride): অনলাইন বা চলমান ট্রিপে থাকলে প্রতি ১৫ সেকেন্ডে GPS → RPC local_ride_driver_ping
//   (সার্ভার ৮ সেকেন্ডের কম ব্যবধান বাদ দেয়, শুধু শেষ লোকেশন রাখে)। অ্যাপ লুকানো থাকলে পাঠায় না।
//   সীমা: অ্যাপ বন্ধ/স্ক্রিন অফে থামে (ব্যাকগ্রাউন্ডের জন্য নেটিভ প্লাগিন + নতুন APK লাগবে, পরের ধাপ)।
// যাত্রী: local_ride_nearby (আশেপাশের গাড়ি, পরিচয় ছাড়া), local_ride_driver_location_for_trip (নিজের ট্রিপের চালক)।
// গাড়ির আইকন: carIcon(L, heading) — Leaflet divIcon (inline style)।
// ============================================================
import { supabase } from './supabase.js';
import { getCurrentPosition } from './native-bridge.js';

const PING_MS = 15000;
let pingTimer = null;
let pingBusy = false;
let shouldPing = () => false;

async function pingOnce() {
  if (pingBusy || document.hidden || !shouldPing()) return;
  pingBusy = true;
  try {
    await new Promise((resolve) => {
      getCurrentPosition(async (pos) => {
        try {
          const c = pos.coords || {};
          await supabase.rpc('local_ride_driver_ping', {
            p_lat: c.latitude,
            p_lng: c.longitude,
            p_heading: typeof c.heading === 'number' && !isNaN(c.heading) ? c.heading : null,
            p_accuracy: typeof c.accuracy === 'number' ? c.accuracy : null,
          });
        } catch (_) { /* পরের বার আবার */ }
        resolve();
      }, () => resolve(), { enableHighAccuracy: true, timeout: 10000, maximumAge: 5000 });
    });
  } finally {
    pingBusy = false;
  }
}

// চালকের পাতায় একবার ডাকো; isActive() true হলে পাঠায় (অনলাইন বা চলমান ট্রিপ)
export function startDriverPinger(isActive) {
  shouldPing = typeof isActive === 'function' ? isActive : () => false;
  if (pingTimer) return;
  pingOnce();
  pingTimer = setInterval(pingOnce, PING_MS);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pingOnce(); });
}
export function pingNow() { pingOnce(); }

export async function fetchNearby(lat, lng) {
  try {
    const { data, error } = await supabase.rpc('local_ride_nearby', { p_lat: lat, p_lng: lng });
    return error ? null : data;
  } catch (_) { return null; }
}
export async function fetchTripDriverLoc(requestId) {
  try {
    const { data, error } = await supabase.rpc('local_ride_driver_location_for_trip', { p_request_id: requestId });
    return error ? null : data;
  } catch (_) { return null; }
}

// গড় ২০ কিমি/ঘণ্টা (সোজা দূরত্ব × ১.৩) — আনুমানিক মিনিট
export function etaMinutes(km) {
  if (km == null || isNaN(km)) return null;
  return Math.max(1, Math.round(((km * 1.3) / 20) * 60));
}

export function carIcon(L, heading, big) {
  const s = big ? 40 : 28;
  const rot = typeof heading === 'number' && !isNaN(heading) ? heading : 0;
  return L.divIcon({
    className: '',
    iconSize: [s, s],
    iconAnchor: [s / 2, s / 2],
    html: '<div style="width:' + s + 'px;height:' + s + 'px;border-radius:50%;background:' + (big ? '#1B2A4A' : '#fff') + ';box-shadow:0 2px 8px rgba(0,0,0,.28);display:flex;align-items:center;justify-content:center;transform:rotate(' + rot + 'deg);transition:transform .6s">'
      + '<svg width="' + (s * 0.62) + '" height="' + (s * 0.62) + '" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l6 18-6-4-6 4z" fill="' + (big ? '#FF6B35' : '#1B8A4A') + '"/></svg></div>',
  });
}
