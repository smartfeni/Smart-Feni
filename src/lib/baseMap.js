// path: src/lib/baseMap.js
// ============================================================
// শেয়ার্ড বেস-ম্যাপ হেল্পার (LocationSelector + LocationPicker)
//
// কাজ: Leaflet ম্যাপে সাধারণ OSM টাইলের বদলে OpenFreeMap-এর ভেক্টর ম্যাপ
// (Liberty — গুগল-ঘেঁষা বিস্তারিত স্টাইল) বসানো। ফ্রি, API key/রেজিস্ট্রেশন
// লাগে না। MapLibre GL + maplibre-gl-leaflet প্লাগিন দিয়ে Leaflet-এর
// ভেতরেই চলে — তাই ওভারলে, পিন, ট্যাপ লজিক সব আগের মতোই থাকে।
//
// ফলব্যাক (ম্যাপ যেন কখনো ফাঁকা না থাকে): WebGL না থাকলে, স্ক্রিপ্ট লোড
// ব্যর্থ হলে, স্টাইল লোড না হলে বা সময়সীমা পার হলে সাধারণ OSM রাস্টার টাইল।
//
// ব্যবহার (Leaflet লোড হওয়ার পর, ম্যাপ বানিয়ে):
//   import { addBaseMap } from '../../lib/baseMap.js';
//   const map = L.map(el, { zoomControl: true }).setView(center, zoom);
//   addBaseMap(L, map);            // Promise<{ kind: 'vector' | 'raster' }>
//   addBaseMap(L, map, { style: 'positron' });   // আরও ক্লিন/মিনিমাল
//
// স্টাইল বদলাতে: নিচে DEFAULT_STYLE বা কলের { style } — 'liberty' | 'positron' | 'bright'
// ডিবাগ: URL-এ ?basemap=raster দিলে জোর করে পুরনো রাস্টার ম্যাপ চালু হয় (ফলব্যাক টেস্টের জন্য)।
//
// লাইব্রেরি (ভার্সন পিন করা): maplibre-gl 4.7.1 (cdnjs) + @maplibre/maplibre-gl-leaflet 0.0.20
// (jsDelivr)। দুটোই শুধু ভেক্টর ম্যাপ লাগলে প্রথমবার ম্যাপ খুললেই লোড হয়।
// CSP এখন Report-Only; enforce করার সময় tiles.openfreemap.org, cdnjs, cdn.jsdelivr.net
// এবং worker-src/img-src-তে blob: যোগ করতে হবে।
//
// অ্যাট্রিবিউশন: "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" Leaflet-এর
// attribution কন্ট্রোলে দেখায় (OSM ডেটার জন্য বাধ্যতামূলক)।
// ============================================================

const DEFAULT_STYLE = 'liberty';

const STYLE_URLS = {
  liberty: 'https://tiles.openfreemap.org/styles/liberty',
  positron: 'https://tiles.openfreemap.org/styles/positron',
  bright: 'https://tiles.openfreemap.org/styles/bright',
};

const MAPLIBRE_CSS = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.css';
const MAPLIBRE_JS = 'https://cdnjs.cloudflare.com/ajax/libs/maplibre-gl/4.7.1/maplibre-gl.min.js';
const MAPLIBRE_LEAFLET_JS =
  'https://cdn.jsdelivr.net/npm/@maplibre/maplibre-gl-leaflet@0.0.20/leaflet-maplibre-gl.js';

const OSM_RASTER_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const VECTOR_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
  '&copy; <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> ' +
  'Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const RASTER_ATTRIBUTION = '&copy; OpenStreetMap contributors';

// ভেক্টর ম্যাপ এর বেশি সময়ে লোড না হলে রাস্টারে ফলব্যাক (ধীর নেটওয়ার্কের জন্য একটু উদার)
const VECTOR_TIMEOUT_MS = 12000;
const MAX_ZOOM = 19;

// ------------------------------------------------------------
// ইন্টারনাল: স্ক্রিপ্ট/CSS লোডার (একবারই লোড, একাধিক কল শেয়ার করে)
// ------------------------------------------------------------
const _loaders = {};

function loadScript(src) {
  if (_loaders[src]) return _loaders[src];
  _loaders[src] = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[src="' + src + '"]');
    if (existing) {
      if (existing.dataset.sfLoaded === '1') return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('স্ক্রিপ্ট লোড ব্যর্থ: ' + src)));
      return;
    }
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => {
      s.dataset.sfLoaded = '1';
      resolve();
    };
    s.onerror = () => reject(new Error('স্ক্রিপ্ট লোড ব্যর্থ: ' + src));
    document.head.appendChild(s);
  }).catch((err) => {
    delete _loaders[src]; // পরের বার আবার চেষ্টা করা যাবে
    throw err;
  });
  return _loaders[src];
}

function loadCss(href) {
  if (document.querySelector('link[href="' + href + '"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = href;
  document.head.appendChild(l);
}

function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) {
    return false;
  }
}

// MapLibre ম্যাপের প্রথম লোড অপেক্ষা: 'load' = সফল; স্টাইল-লেভেল error বা টাইমআউট = ব্যর্থ
// (একটা-দুটো টাইল ব্যর্থ হলে — e.sourceId/e.tile থাকে — সেটা স্টাইল-ব্যর্থতা ধরা হয় না)
function waitForLoad(gl, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!gl) return reject(new Error('MapLibre ম্যাপ পাওয়া যায়নি'));
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve();
    };
    const timer = setTimeout(() => finish(new Error('ভেক্টর ম্যাপ লোডে সময়সীমা পার')), timeoutMs);
    gl.once('load', () => finish());
    gl.on('error', (e) => {
      if (done) return;
      if (e && !e.sourceId && !e.tile) finish((e && e.error) || new Error('স্টাইল লোড ব্যর্থ'));
    });
  });
}

function addRaster(L, map) {
  const layer = L.tileLayer(OSM_RASTER_URL, {
    attribution: RASTER_ATTRIBUTION,
    maxZoom: MAX_ZOOM,
  }).addTo(map);
  return { kind: 'raster', layer };
}

function ensureMaxZoom(map) {
  try {
    if (map.getMaxZoom() === Infinity) map.setMaxZoom(MAX_ZOOM);
  } catch (e) {
    /* ইগনোর */
  }
}

// ------------------------------------------------------------
// পাবলিক: ম্যাপে বেস লেয়ার বসানো। কখনো reject করে না — সবসময় একটা ম্যাপ থাকে।
// রিটার্ন: Promise<{ kind: 'vector' | 'raster', layer }>
// ------------------------------------------------------------
export async function addBaseMap(L, map, options = {}) {
  const style = options.style || DEFAULT_STYLE;
  const styleUrl = STYLE_URLS[style] || style; // কাস্টম URL-ও দেওয়া যায়
  const timeoutMs = options.timeoutMs || VECTOR_TIMEOUT_MS;

  ensureMaxZoom(map);

  // ডিবাগ: ?basemap=raster
  let forceRaster = false;
  try {
    forceRaster = new URLSearchParams(window.location.search).get('basemap') === 'raster';
  } catch (e) {
    /* ইগনোর */
  }
  if (forceRaster || !hasWebGL()) return addRaster(L, map);

  let vectorLayer = null;
  try {
    loadCss(MAPLIBRE_CSS);
    await loadScript(MAPLIBRE_JS);
    await loadScript(MAPLIBRE_LEAFLET_JS);
    if (typeof L.maplibreGL !== 'function') throw new Error('maplibre-gl-leaflet প্লাগিন পাওয়া যায়নি');

    vectorLayer = L.maplibreGL({ style: styleUrl, attribution: VECTOR_ATTRIBUTION });
    vectorLayer.addTo(map);
    await waitForLoad(vectorLayer.getMaplibreMap(), timeoutMs);
    return { kind: 'vector', layer: vectorLayer };
  } catch (err) {
    console.warn('[baseMap] ভেক্টর ম্যাপ ব্যর্থ — OSM রাস্টারে ফলব্যাক:', err);
    try {
      if (vectorLayer && map.hasLayer(vectorLayer)) map.removeLayer(vectorLayer);
    } catch (e) {
      /* ইগনোর */
    }
    return addRaster(L, map);
  }
}