// ============================================================
// Leaflet লোডার — শেয়ার্ড (LocationSelector, LocationPicker, MarketLocationSheet, DeliveryOrderFlow)
//
// আগের বাগ (অডিট P1, ১৯ নভে ২০২৬): ৪ জায়গায় কপি করা লোডার cdnjs থেকে স্ক্রিপ্ট আনত।
// একবার লোড ফেইল করলে ফেইল হওয়া <script> পেজে থেকে যেত; পরের চেষ্টায় কোড সেটার
// load/error-এর অপেক্ষা করত যা আর কখনো আসে না → ম্যাপ চিরকাল ফাঁকা, কোনো এরর/রিট্রাই নেই।
//
// এখন:
//   • Leaflet নিজেদের সাইট থেকে (/vendor/leaflet-1.9.4/, ভার্সন-পিন করা, immutable ক্যাশ)
//   • window.L থাকলে সাথে সাথে resolve
//   • ফেইল হলে ফেইল হওয়া স্ক্রিপ্ট মুছে নতুন করে চেষ্টা (মোট ৩ বার, মাঝে বিরতি)
//   • সব চেষ্টা ব্যর্থ হলে reject; পরের কল আবার শুরু থেকে চেষ্টা করে
//   • mapRetryBox(): ম্যাপের জায়গায় "আবার চেষ্টা করুন" বাটন (ফাঁকা ম্যাপের বদলে)
// Leaflet ভার্সন বদলালে ফোল্ডার নামও বদলাও (ক্যাশ immutable)।
// ============================================================

const BASE = '/vendor/leaflet-1.9.4';
const JS_URL = `${BASE}/leaflet.js`;
const CSS_URL = `${BASE}/leaflet.css`;
const ATTEMPTS = 3;
const TIMEOUT_MS = 15000;

let inflight = null;

function ensureCss() {
  if (document.querySelector(`link[data-sf-leaflet-css]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CSS_URL;
  link.setAttribute('data-sf-leaflet-css', '1');
  document.head.appendChild(link);
}

function injectScriptOnce() {
  return new Promise((resolve, reject) => {
    document.querySelectorAll('script[data-sf-leaflet]').forEach((s) => s.remove());
    const s = document.createElement('script');
    s.src = JS_URL;
    s.async = true;
    s.setAttribute('data-sf-leaflet', '1');
    const timer = setTimeout(() => {
      s.remove();
      reject(new Error('Leaflet লোড টাইমআউট'));
    }, TIMEOUT_MS);
    s.onload = () => {
      clearTimeout(timer);
      if (window.L) resolve();
      else {
        s.remove();
        reject(new Error('Leaflet লোড হয়েছে কিন্তু L পাওয়া যায়নি'));
      }
    };
    s.onerror = () => {
      clearTimeout(timer);
      s.remove();
      reject(new Error('Leaflet লোড ব্যর্থ'));
    };
    document.head.appendChild(s);
  });
}

export function loadLeaflet() {
  if (window.L) {
    ensureCss();
    return Promise.resolve();
  }
  if (inflight) return inflight;

  inflight = (async () => {
    ensureCss();
    let lastErr = null;
    for (let i = 0; i < ATTEMPTS; i++) {
      try {
        await injectScriptOnce();
        return;
      } catch (err) {
        lastErr = err;
        if (window.L) return;
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
      }
    }
    throw lastErr || new Error('Leaflet লোড ব্যর্থ');
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

// ম্যাপের কন্টেইনারে "ম্যাপ লোড হয়নি — আবার চেষ্টা করুন" বক্স। onRetry চাপলে বক্স সরে যায়।
// একই কন্টেইনারে আবার ডাকলে পুরনোটা বদলে যায় (ডুপ্লিকেট হয় না)।
export function mapRetryBox(container, onRetry, message = 'ম্যাপ লোড হয়নি। নেট চেক করে আবার চেষ্টা করুন।') {
  if (!container) return null;
  removeMapRetryBox(container);
  const box = document.createElement('div');
  box.className = 'sf-map-retry';
  box.setAttribute('role', 'alert');
  box.style.cssText =
    'position:absolute;inset:0;z-index:500;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;' +
    'background:#F8FAFC;border-radius:inherit;padding:16px;text-align:center;';
  const icon = document.createElement('i');
  icon.className = 'fas fa-map-location-dot';
  icon.style.cssText = 'font-size:1.6rem;color:#FF6B35;';
  const p = document.createElement('p');
  p.textContent = message;
  p.style.cssText = 'margin:0;font-size:0.85rem;font-weight:600;color:#1B2A4A;max-width:260px;line-height:1.5;';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = 'আবার চেষ্টা করুন';
  btn.setAttribute('data-sf-loader', 'off');
  btn.style.cssText =
    'border:0;border-radius:999px;background:#FF6B35;color:#fff;font-weight:700;font-size:0.85rem;padding:9px 20px;cursor:pointer;box-shadow:0 4px 12px rgba(255,107,53,0.3);';
  btn.addEventListener('click', () => {
    box.remove();
    try {
      onRetry && onRetry();
    } catch (_) {
      /* কলার নিজে এরর সামলায় */
    }
  });
  box.append(icon, p, btn);
  if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
  container.appendChild(box);
  return box;
}

export function removeMapRetryBox(container) {
  container?.querySelectorAll(':scope > .sf-map-retry').forEach((b) => b.remove());
}
