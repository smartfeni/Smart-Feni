// path: src/lib/baseMap.js
// ============================================================
// শেয়ার্ড বেস-ম্যাপ হেল্পার (LocationSelector + LocationPicker)
//
// কাজ: Leaflet ম্যাপে সাধারণ OSM টাইলের বদলে OpenFreeMap-এর ভেক্টর ম্যাপ বসানো।
// ডিফল্ট স্টাইল 'smartfeni': Liberty-র ওপর ব্র্যান্ড রং (রাস্তা কমলা, নেভি লেখা, হালকা বেস)। ফ্রি, API key/রেজিস্ট্রেশন
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
//   addBaseMap(L, map, { poi: false });   // POI লেবেল ছাড়া (নিজস্ব চিপ থাকলে)
//   addBaseMap(L, map, { style: 'positron' });   // অন্য স্টাইল (বাংলা লেখা ভাঙবে — শুধু টেস্ট)
//
// স্টাইল বদলাতে: নিচে DEFAULT_STYLE বা কলের { style } — 'smartfeni' | 'liberty' | 'positron' | 'bright'
//
// বাংলা লেখা (জরুরি নিয়ম): MapLibre বাংলা যুক্তাক্ষর জোড়া লাগাতে পারে না (লেখা ভেঙে যায়)।
// তাই 'smartfeni' স্টাইলে MapLibre-এর সব লেখা/আইকন (symbol লেয়ার) বাদ, আর জায়গার নাম
// (শহর/গ্রাম/এলাকা, চাইলে দোকান/স্কুলের মতো POI) Leaflet HTML লেবেলে আঁকা হয় — ব্রাউজার
// বাংলা ঠিক আঁকে। অপশন: { labels: false } সব লেবেল বন্ধ, { poi: false } শুধু POI বন্ধ
// (যেমন LocationPicker-এ নিজস্ব "আশপাশের জায়গা" চিপ আছে)।
// লেবেল প্যান 'sfBaseLabels' (z 405) — কম্পোনেন্টের ওভারলে প্যানগুলোর (410+) নিচে।
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

const DEFAULT_STYLE = 'smartfeni';

const LIBERTY_URL = 'https://tiles.openfreemap.org/styles/liberty';

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

// ------------------------------------------------------------
// 'smartfeni' স্টাইল: Liberty JSON এনে রং বদল + সব symbol লেয়ার বাদ (লেখা HTML-এ)
// ------------------------------------------------------------
const C = {
  bg: '#F7F5F0', water: '#A9D3EA', waterLine: '#8FC3E0', green: '#DCEBD2', land: '#F1EDE6',
  bld: '#E6E0D6', bldLine: '#D9D1C4', motor: '#FF8A57', motorCase: '#E8703E', primary: '#FFC09C',
  primaryCase: '#EEA57E', minor: '#FFFFFF', minorCase: '#DDD5C8', boundary: '#B9C2D3',
};

function themeSmartFeni(style) {
  style.layers = (style.layers || []).filter((l) => {
    if (l.type === 'symbol') return false;
    const sl = l['source-layer'] || '';
    const id = l.id || '';
    const t = l.type;
    const p = l.paint || (l.paint = {});
    if (t === 'background') p['background-color'] = C.bg;
    else if (sl === 'water' && t === 'fill') p['fill-color'] = C.water;
    else if (sl === 'waterway' && t === 'line') p['line-color'] = C.waterLine;
    else if (sl === 'park' && t === 'fill') p['fill-color'] = C.green;
    else if (sl === 'landcover' && t === 'fill') { p['fill-color'] = C.green; p['fill-opacity'] = 0.5; }
    else if (sl === 'landuse' && t === 'fill') p['fill-color'] = C.land;
    else if (sl === 'building') {
      if (t === 'fill') { p['fill-color'] = C.bld; p['fill-outline-color'] = C.bldLine; }
      if (t === 'fill-extrusion') p['fill-extrusion-color'] = C.bld;
    } else if (sl === 'boundary' && t === 'line') p['line-color'] = C.boundary;
    else if (sl === 'transportation' && t === 'line' && !/rail|path|track|ferry|aeroway|pedestrian/.test(id)) {
      const cas = /casing/.test(id);
      if (/motorway|trunk/.test(id)) p['line-color'] = cas ? C.motorCase : C.motor;
      else if (/primary/.test(id)) p['line-color'] = cas ? C.primaryCase : C.primary;
      else if (/secondary|tertiary|minor|service|street|residential/.test(id)) p['line-color'] = cas ? C.minorCase : C.minor;
    }
    return true;
  });
  return style;
}

let _sfStylePromise = null;
async function loadSmartFeniStyle() {
  if (!_sfStylePromise) {
    _sfStylePromise = fetch(LIBERTY_URL)
      .then((r) => {
        if (!r.ok) throw new Error('স্টাইল লোড ব্যর্থ: ' + r.status);
        return r.json();
      })
      .then(themeSmartFeni)
      .catch((err) => {
        _sfStylePromise = null; // পরের বার আবার চেষ্টা
        throw err;
      });
  }
  return JSON.parse(JSON.stringify(await _sfStylePromise)); // প্রতিটা ম্যাপ নিজের কপি পায়
}

// ------------------------------------------------------------
// HTML লেবেল (বাংলা ঠিক রাখতে) — ভেক্টর টাইলের place/poi ফিচার থেকে, কোলিশন এড়িয়ে
// ------------------------------------------------------------
const PLACE_RULES = {
  // class: [ন্যূনতম জুম, অগ্রাধিকার (কম = আগে), সাইজ-ক্লাস]
  city: [7, 0, 'lg'], town: [9, 1, 'lg'], suburb: [12, 2, 'md'], village: [13, 3, 'md'],
  quarter: [14, 4, 'sm'], neighbourhood: [14, 4, 'sm'], hamlet: [15, 5, 'sm'],
};
const POI_MIN_ZOOM = 15;
const MAX_LABELS = 70;
const BN_RE = /[\u0980-\u09FF]/;

function labelName(p) {
  if (!p) return '';
  if (p['name:bn']) return p['name:bn'];
  if (p.name && BN_RE.test(p.name)) return p.name;
  return p['name:en'] || p.name_en || p['name:latin'] || p.name || '';
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

function injectLabelCss() {
  if (document.getElementById('sf-base-label-css')) return;
  const st = document.createElement('style');
  st.id = 'sf-base-label-css';
  st.textContent =
    '.sfbl-wrap{background:none;border:0}' +
    '.sfbl{position:absolute;left:0;top:0;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;' +
    "font-family:'Hind Siliguri',system-ui,sans-serif;line-height:1.1;" +
    'text-shadow:0 0 2px #fff,0 0 3px #fff,0 0 5px #fff,0 0 7px #fff}' +
    '.sfbl-lg{font-size:13.5px;font-weight:700;color:#1B2A4A}' +
    '.sfbl-md{font-size:12px;font-weight:600;color:#33415C}' +
    '.sfbl-sm{font-size:11px;font-weight:600;color:#5B6B86}' +
    '.sfbl-poi{font-size:11px;font-weight:500;color:#6B5E4E;display:inline-flex;align-items:center;gap:4px}' +
    '.sfbl-poi::before{content:"";width:6px;height:6px;border-radius:50%;background:#FF8A57;box-shadow:0 0 0 1.5px #fff}';
  document.head.appendChild(st);
}

function attachLabels(L, map, gl, vectorLayer, opts) {
  if (!map.getPane('sfBaseLabels')) {
    const pane = map.createPane('sfBaseLabels');
    pane.style.zIndex = '405';
    pane.style.pointerEvents = 'none';
  }
  injectLabelCss();
  const group = L.layerGroup().addTo(map);
  let timer = null;

  function draw() {
    group.clearLayers();
    if (!map.hasLayer(vectorLayer)) return;
    const z = map.getZoom();
    const size = map.getSize();
    const items = [];
    const q = (sourceLayer) => {
      try {
        return gl.querySourceFeatures('openmaptiles', { sourceLayer }) || [];
      } catch (e) {
        return [];
      }
    };

    q('place').forEach((f) => {
      const rule = PLACE_RULES[f.properties && f.properties.class];
      if (!rule || z < rule[0] || !f.geometry || f.geometry.type !== 'Point') return;
      items.push({ f, pri: rule[1] * 1000 + (f.properties.rank || 99), cls: 'sfbl-' + rule[2], h: rule[2] === 'lg' ? 18 : 15 });
    });
    if (opts.poi && z >= POI_MIN_ZOOM) {
      q('poi').forEach((f) => {
        if (!f.geometry || f.geometry.type !== 'Point') return;
        items.push({ f, pri: 9000 + (f.properties.rank || 99), cls: 'sfbl-poi', h: 14 });
      });
    }
    items.sort((a, b) => a.pri - b.pri);

    const taken = [];
    const seen = new Set();
    let count = 0;
    for (const it of items) {
      if (count >= MAX_LABELS) break;
      const name = labelName(it.f.properties);
      if (!name) continue;
      const [lng, lat] = it.f.geometry.coordinates;
      const key = name + '|' + lat.toFixed(3) + '|' + lng.toFixed(3);
      if (seen.has(key)) continue; // একই ফিচার পাশের টাইলেও থাকে
      seen.add(key);
      const pt = map.latLngToContainerPoint([lat, lng]);
      if (pt.x < 0 || pt.y < 0 || pt.x > size.x || pt.y > size.y) continue;
      const w = name.length * (it.cls === 'sfbl-lg' ? 8 : 6.6) + (it.cls === 'sfbl-poi' ? 14 : 8);
      const r = { x: pt.x - w / 2, y: pt.y - it.h / 2, w, h: it.h };
      if (taken.some((t) => r.x < t.x + t.w && r.x + r.w > t.x && r.y < t.y + t.h && r.y + r.h > t.y)) continue;
      taken.push(r);
      count++;
      L.marker([lat, lng], {
        pane: 'sfBaseLabels',
        interactive: false,
        keyboard: false,
        icon: L.divIcon({
          className: 'sfbl-wrap',
          iconSize: [0, 0],
          html: '<span class="sfbl ' + it.cls + '" data-no-i18n>' + escHtml(name) + '</span>',
        }),
      }).addTo(group);
    }
  }

  const redraw = () => {
    clearTimeout(timer);
    timer = setTimeout(draw, 150);
  };
  const hide = () => group.clearLayers(); // জুম অ্যানিমেশনের সময় পুরনো লেবেল সরে যায়
  gl.on('idle', redraw);
  map.on('moveend', redraw);
  map.on('zoomstart', hide);
  vectorLayer.once('remove', () => {
    clearTimeout(timer);
    try { gl.off('idle', redraw); } catch (e) { /* ইগনোর */ }
    map.off('moveend', redraw);
    map.off('zoomstart', hide);
    try { map.removeLayer(group); } catch (e) { /* ইগনোর */ }
  });
  redraw();
  return group;
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
  const themed = style === 'smartfeni';
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

    // 'smartfeni' = থিম করা স্টাইল অবজেক্ট; অন্য নাম = OpenFreeMap URL; বাকি = কাস্টম URL/অবজেক্ট
    const styleArg = themed ? await loadSmartFeniStyle() : STYLE_URLS[style] || style;
    vectorLayer = L.maplibreGL({ style: styleArg, attribution: VECTOR_ATTRIBUTION });
    vectorLayer.addTo(map);
    const gl = vectorLayer.getMaplibreMap();
    await waitForLoad(gl, timeoutMs);
    let labels = null;
    if (themed && options.labels !== false) {
      try {
        labels = attachLabels(L, map, gl, vectorLayer, { poi: options.poi !== false });
      } catch (e) {
        console.warn('[baseMap] লেবেল ব্যর্থ (ম্যাপ চলবে):', e);
      }
    }
    return { kind: 'vector', layer: vectorLayer, labels };
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