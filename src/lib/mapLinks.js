// ============================================================
// ম্যাপ লিংক হেল্পার (শেয়ার্ড)
//
// কাজ: যেকোনো টেক্সটে (চ্যাট মেসেজ / অ্যাড্রেস বক্স) গুগল ম্যাপ লিংক বা
// কোঅর্ডিনেট (lat,lng) থাকলে সেটা চিনে বের করা এবং রাইডারের জন্য
// "নেভিগেট করুন" বাটন বানানো, যেটা ট্যাপ করলে গুগল ম্যাপ খোলে।
//
// ব্যবহার:
//   import { findMapLink, createNavButton } from '../lib/mapLinks.js';
//   const link = findMapLink(text);          // null অথবা { url, navUrl, lat, lng }
//   if (link) container.appendChild(createNavButton(link));
//
// চেনা যায়: google.com/maps/..., maps.google.com, maps.app.goo.gl,
// goo.gl/maps, geo:lat,lng এবং সরাসরি "23.0159, 91.3976" ধরনের কোঅর্ডিনেট
// (শুধু বাংলাদেশের আশেপাশের রেঞ্জে, যাতে দাম/নম্বরকে ভুল না ধরে)।
// ============================================================

import { getCurrentPosition } from './native-bridge.js';

const URL_REGEX = /(https?:\/\/[^\s<>"']+|geo:[^\s<>"']+)/gi;
const COORD_REGEX = /(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/;

// URL-এর শেষের বাড়তি চিহ্ন (দাঁড়ি, কমা, বন্ধনী) বাদ দেওয়া
function trimTrailing(url) {
  return url.replace(/[)\].,;!?।]+$/u, '');
}

// বাংলাদেশের আশেপাশের কোঅর্ডিনেট কিনা (ভুল পজিটিভ ঠেকাতে)
function inRange(lat, lng) {
  return lat >= 20 && lat <= 27 && lng >= 87 && lng <= 93;
}

// গুগল ম্যাপ URL থেকে lat/lng বের করার চেষ্টা (না পেলে null)
function extractCoords(url) {
  let decoded = url;
  try { decoded = decodeURIComponent(url); } catch (e) { /* যেমন আছে তেমন */ }

  const patterns = [
    /@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/,                 // /@23.01,91.39,17z
    /[?&](?:q|query|destination|ll|daddr)=(-?\d{1,2}\.\d+)[,+ ]+(-?\d{1,3}\.\d+)/, // ?q=23.01,91.39
    /!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/,             // place data
    /^geo:(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/i,            // geo:23.01,91.39
  ];

  for (const re of patterns) {
    const m = decoded.match(re);
    if (m) {
      const lat = parseFloat(m[1]);
      const lng = parseFloat(m[2]);
      if (!Number.isNaN(lat) && !Number.isNaN(lng)) return { lat, lng };
    }
  }
  return null;
}

// URL-টা কি গুগল ম্যাপের?
export function isMapUrl(url) {
  if (!url) return false;
  if (/^geo:/i.test(url)) return true;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    const path = u.pathname.toLowerCase();
    if (host === 'maps.app.goo.gl') return true;
    if (host === 'maps.google.com') return true;
    if (host === 'goo.gl' && path.startsWith('/maps')) return true;
    if (/^google\.[a-z.]+$/.test(host) && path.startsWith('/maps')) return true;
    return false;
  } catch (e) {
    return false;
  }
}

// কোঅর্ডিনেট থেকে ড্রাইভিং নেভিগেশন URL (গুগল ম্যাপ অ্যাপ/ওয়েব দুটোতেই চলে)
export function navUrlFromCoords(lat, lng) {
  return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`;
}

// টেক্সটে ম্যাপ লিংক/কোঅর্ডিনেট থাকলে প্রথমটা ফেরত দেয়, না থাকলে null
// রিটার্ন: { url, navUrl, lat, lng, matchedText } — lat/lng না পেলে null
export function findMapLink(text) {
  if (!text || typeof text !== 'string') return null;

  const urls = text.match(URL_REGEX) || [];
  for (const raw of urls) {
    const url = trimTrailing(raw);
    if (!isMapUrl(url)) continue;
    const coords = extractCoords(url);
    return {
      url,
      // কোঅর্ডিনেট পেলে সরাসরি নেভিগেশন মোড, না পেলে (শর্ট লিংক) আসল লিংকই খুলবে
      navUrl: coords ? navUrlFromCoords(coords.lat, coords.lng) : url,
      lat: coords ? coords.lat : null,
      lng: coords ? coords.lng : null,
      matchedText: raw,
    };
  }

  const c = text.match(COORD_REGEX);
  if (c) {
    const lat = parseFloat(c[1]);
    const lng = parseFloat(c[2]);
    if (inRange(lat, lng)) {
      return {
        url: navUrlFromCoords(lat, lng),
        navUrl: navUrlFromCoords(lat, lng),
        lat,
        lng,
        matchedText: c[0],
      };
    }
  }

  return null;
}

// "নেভিগেট করুন" বাটন (আসলে <a>), ট্যাপ করলে গুগল ম্যাপ খোলে।
// অ্যাপের WebView-তে বাইরের লিংক সিস্টেমের মাধ্যমে খোলে, তাই Maps অ্যাপ
// ইনস্টল থাকলে সেটাই আসে। স্টাইল ইনলাইন (scoped CSS সমস্যা এড়াতে)।
export function createNavButton(link, label = 'নেভিগেট করুন') {
  const a = document.createElement('a');
  a.href = link.navUrl;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.className = 'sf-nav-btn';
  a.setAttribute(
    'style',
    [
      'display:inline-flex',
      'align-items:center',
      'justify-content:center',
      'gap:6px',
      'margin-top:6px',
      'padding:8px 14px',
      'border-radius:10px',
      'background:#1B2A4A',
      'color:#fff',
      'font-size:0.8rem',
      'font-weight:700',
      'text-decoration:none',
      'line-height:1.2',
      'align-self:flex-start',
    ].join(';')
  );
  a.innerHTML = '<i class="fas fa-location-arrow"></i>';
  const span = document.createElement('span');
  span.textContent = label;
  a.appendChild(span);
  // বাবল/কার্ডের অন্য ক্লিক হ্যান্ডলারে যেন না আটকে
  a.addEventListener('click', (e) => e.stopPropagation());
  return a;
}

// অ্যাড্রেস টেক্সট থেকে শুধু নেভিগেশন URL চাইলে (HTML টেমপ্লেটে ব্যবহারের জন্য)
export function getNavUrl(text) {
  const link = findMapLink(text);
  return link ? link.navUrl : null;
}

// ---------------- ডেলিভারি UI v2 যোগ ----------------

// টেক্সট থেকে ম্যাপ লিংক/কোঅর্ডিনেট সরিয়ে ফেলে (ইউজারকে লিংক দেখানো হবে না)।
// রিটার্ন: { text: লিংক ছাড়া পরিষ্কার টেক্সট, link: findMapLink-এর ফলাফল বা null }
export function splitMapLink(text) {
  const link = findMapLink(text);
  if (!link) return { text: typeof text === 'string' ? text.trim() : '', link: null };
  const cleaned = text
    .replace(link.matchedText, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: cleaned, link };
}

// অ্যাড্রেস দেখানোর কাজ: টেক্সট textContent-এ (নিরাপদ), লিংক থাকলে শুধু "নেভিগেট করুন" বাটন।
// coords = { lat, lng } দিলে (যেমন lat/lng কলাম থেকে) লিংক না থাকলেও বাটন আসে।
export function renderAddressWithNav(container, text, opts = {}) {
  if (!container) return;
  container.textContent = '';
  const { text: clean, link } = splitMapLink(text);
  if (clean) {
    const p = document.createElement('div');
    p.textContent = clean;
    container.appendChild(p);
  }
  let navLink = link;
  const c = opts.coords;
  if (!navLink && c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))) {
    const url = navUrlFromCoords(Number(c.lat), Number(c.lng));
    navLink = { url, navUrl: url, lat: Number(c.lat), lng: Number(c.lng) };
  }
  if (navLink) container.appendChild(createNavButton(navLink, opts.label));
}

// "বর্তমান লোকেশন পাঠান": ব্যাকগ্রাউন্ডে GPS নেয় (অ্যাপে Capacitor, ব্রাউজারে navigator)।
// রিটার্ন Promise<{ lat, lng, accuracy, navUrl }>; পারমিশন না দিলে/টাইমআউটে reject।
// UI-তে লিংক দেখাবে না; navUrl অ্যাড্রেস টেক্সটের সাথে জমা রাখলে রাইডার/অ্যাডমিন বাটন পাবে।
export function requestCurrentLocation(options = {}) {
  return new Promise((resolve, reject) => {
    getCurrentPosition(
      (pos) => {
        const lat = pos && pos.coords ? pos.coords.latitude : null;
        const lng = pos && pos.coords ? pos.coords.longitude : null;
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          reject(new Error('Location unavailable'));
          return;
        }
        resolve({
          lat,
          lng,
          accuracy: pos.coords.accuracy ?? null,
          navUrl: navUrlFromCoords(lat, lng),
        });
      },
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 10000, ...options }
    );
  });
}
