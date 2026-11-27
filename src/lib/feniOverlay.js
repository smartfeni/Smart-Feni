// path: src/lib/feniOverlay.js
// ============================================================
// শেয়ার্ড ফেনী ম্যাপ ওভারলে — সাইটের সব ম্যাপ একই রকম দেখাবে (SF, ২৭ নভে ২০২৬)
//
// যেকোনো Leaflet ম্যাপে এক লাইনে:
//   import { addFeniOverlay } from '../lib/feniOverlay.js';
//   const ov = await addFeniOverlay(L, map);              // সব ডিফল্ট
//   const ov = await addFeniOverlay(L, map, { onAreaTap: (a) => ... });  // ইউনিয়ন ট্যাপ চাইলে
//
// যা আঁকে:
//   • জেলার সীমানা: কমলা গ্লো + সাদা হ্যালো + নেভি লাইন
//   • ৬ উপজেলা: প্রতিটার নিজের রঙে হালকা ফিল + সাদা হ্যালোসহ গাঢ় বর্ডার
//   • ইউনিয়ন: উপজেলার গাঢ় রঙে সরু ড্যাশ বর্ডার
//   • নাম: উপজেলার নাম পিল (দূর থেকে), ইউনিয়নের নাম (জুম ১১.৫+), কাছে গেলে উপজেলার পিল লুকায়
//   • ফ্রি প্যান: ফেনীর যেকোনো কোণ (সোনাগাজীর চরসহ) টেনে ম্যাপের মাঝখানে আনা যায়,
//     উপর-নিচ-ডান-বাম সব দিকে; ফেনী থেকে অনেক দূরে গেলে নরমভাবে ফিরে আসে
//
// রিটার্ন: { geo, highlight(unionEn|null), flyToUpazila(id), fitAll(), areaAt(latlng), remove() }
// ওভারলে ডিফল্টে ট্যাপ আটকায় না — মাঝের পিন, রুট, মার্কার আগের মতো কাজ করে।
// নির্ভরতা শুধু feniAreas.js (তাই আর্টিফেক্ট প্রিভিউতেও হুবহু এই ফাইল চলে)।
// ============================================================
import {
  UPAZILAS,
  loadFeniGeo,
  getUnionBn,
  getUnionUpazilaId,
  getUpazilaBorders,
  getUpazilaBounds,
  getLabelPoints,
  getFeniBounds,
  getDistrictBorder,
  findAreaAt,
} from '../data/feniAreas.js';

// প্যালেট — প্রতিটা উপজেলা আলাদা রঙ; এক জায়গাতেই রাখা: feniAreas.js-এর UPAZILAS
// (ফেনী সদর গোলাপি-লাল, ছাগলনাইয়া সবুজ, দাগনভূঞা নীল, পরশুরাম অ্যাম্বার, ফুলগাজী বেগুনি, সোনাগাজী সায়ান)
export const FENI_MAP_COLORS = Object.fromEntries(UPAZILAS.map((u) => [u.id, u.color]));
export const DISTRICT_LINE = '#1B2A4A';
export const DISTRICT_GLOW = '#FF6B35';

export function upazilaColor(id) {
  return FENI_MAP_COLORS[id] || '#64748B';
}

// রঙ গাঢ় করা (বর্ডার/লেখার জন্য)
export function deepen(hex, k = 0.38) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.round(v * (1 - k)).toString(16).padStart(2, '0');
  return '#' + f((n >> 16) & 255) + f((n >> 8) & 255) + f(n & 255);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const CSS = `
.fo-up{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:6px;white-space:nowrap;
  padding:5px 11px 5px 7px;border-radius:999px;background:rgba(255,255,255,.96);color:#1B2A4A;
  font:700 13px/1.2 'Hind Siliguri','Noto Sans Bengali',system-ui,sans-serif;
  box-shadow:0 2px 10px rgba(27,42,74,.18),0 0 0 1.5px var(--c);pointer-events:none;transition:opacity .2s}
.fo-up i{width:10px;height:10px;border-radius:50%;background:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 22%,transparent)}
.fo-un{position:absolute;transform:translate(-50%,-50%);white-space:nowrap;pointer-events:none;
  font:600 11px/1.2 'Hind Siliguri','Noto Sans Bengali',system-ui,sans-serif;color:var(--c);letter-spacing:.1px;
  text-shadow:0 0 2px #fff,0 0 3px #fff,0 0 5px #fff,0 1px 0 #fff;transition:opacity .2s,font-size .2s}
.fo-un.on{transform:translate(-50%,45%);color:#fff;background:var(--c);padding:3px 9px;border-radius:999px;text-shadow:none;box-shadow:0 2px 8px rgba(0,0,0,.22)}
.fo-z1 .fo-un{opacity:0}
.fo-z3 .fo-up{opacity:0}
.fo-z3 .fo-un{font-size:13px}
`;
function injectCss() {
  if (document.getElementById('fo-css')) return;
  const s = document.createElement('style');
  s.id = 'fo-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

// ফ্রি প্যান: সীমা = ফেনী + অর্ধেক স্ক্রিন, তাই ফেনীর যেকোনো কোণ মাঝখানে আনা যায়
export function freePanToFeni(L, map, feniBounds) {
  if (map._sfFreePan) return map._sfFreePan; // একই ম্যাপে দুবার নয়
  const fb = L.latLngBounds(feniBounds);
  if (!map._loaded) map.fitBounds(fb, { padding: [16, 16] });
  const apply = () => {
    const vb = map.getBounds();
    const hLat = (vb.getNorth() - vb.getSouth()) / 2;
    const hLng = (vb.getEast() - vb.getWest()) / 2;
    map.setMaxBounds(L.latLngBounds(
      [fb.getSouth() - hLat, fb.getWest() - hLng],
      [fb.getNorth() + hLat, fb.getEast() + hLng]
    ));
  };
  map.options.maxBoundsViscosity = 0.85; // কিনারে নরম টান
  map.setMinZoom(Math.max(8, map.getBoundsZoom(fb) - 1));
  apply();
  map.on('zoomend resize', apply);
  map._sfFreePan = () => { map.off('zoomend resize', apply); map._sfFreePan = null; };
  return map._sfFreePan;
}

export async function addFeniOverlay(L, map, opts = {}) {
  const o = Object.assign({
    geo: null,
    labels: true,
    unionLabelZoom: 11.5,
    upazilaHideZoom: 13.5,
    freePan: true,
    fit: false,
    onAreaTap: null, // (area, latlng) => {} — দিলে ইউনিয়ন ট্যাপযোগ্য
  }, opts);
  injectCss();
  const geo = o.geo || (await loadFeniGeo());

  const panes = [['foFill', 403], ['foUnion', 406], ['foUpazila', 407], ['foDistrict', 408], ['foLabels', 455]];
  panes.forEach(([n, z]) => {
    if (!map.getPane(n)) map.createPane(n);
    map.getPane(n).style.zIndex = String(z);
  });
  ['foUnion', 'foUpazila', 'foDistrict', 'foLabels'].forEach((n) => { map.getPane(n).style.pointerEvents = 'none'; });

  const group = L.layerGroup().addTo(map);
  const unionLayers = {};
  const unionLabels = {};
  let selected = null;

  const baseStyle = (en) => {
    const c = upazilaColor(getUnionUpazilaId(en));
    return { pane: 'foFill', stroke: true, color: deepen(c), weight: 1, opacity: 0.55, dashArray: '3 4', fill: true, fillColor: c, fillOpacity: 0.13 };
  };
  const selStyle = (en) => {
    const c = upazilaColor(getUnionUpazilaId(en));
    return { color: deepen(c, 0.2), weight: 3, opacity: 1, dashArray: null, fillColor: c, fillOpacity: 0.34 };
  };

  // ১) ইউনিয়ন: ফিল + সরু ড্যাশ বর্ডার
  (geo.features || []).forEach((f) => {
    const en = f.properties && f.properties.shapeName;
    if (!en || !getUnionUpazilaId(en)) return;
    const ly = L.geoJSON(f, { interactive: !!o.onAreaTap, style: () => baseStyle(en) });
    if (o.onAreaTap) {
      ly.on('click', (e) => {
        const a = findAreaAt(e.latlng.lat, e.latlng.lng, geo);
        o.onAreaTap(a, e.latlng);
      });
    }
    unionLayers[en] = ly;
    group.addLayer(ly);
  });

  // ২) উপজেলার বর্ডার: সাদা হ্যালো + নিজের গাঢ় রঙ
  const ub = getUpazilaBorders(geo);
  UPAZILAS.forEach((u) => {
    const segs = ub[u.id];
    if (!segs || !segs.length) return;
    group.addLayer(L.polyline(segs, { pane: 'foUpazila', color: '#fff', weight: 6, opacity: 0.9, interactive: false, lineCap: 'round' }));
    group.addLayer(L.polyline(segs, { pane: 'foUpazila', color: deepen(upazilaColor(u.id), 0.25), weight: 2.6, opacity: 1, interactive: false, lineCap: 'round' }));
  });

  // ৩) জেলা: গ্লো + হ্যালো + নেভি লাইন (ইউনিয়নের কিনারা থেকে, তাই চরসহ হুবহু মেলে)
  {
    // লাইন আঁকা হয় সরাসরি edge থেকে — কোনো ভুল জোড়া/কোনাকুনি দাগ পড়ে না
    const segs = getDistrictBorder(geo);
    group.addLayer(L.polyline(segs, { pane: 'foDistrict', color: DISTRICT_GLOW, weight: 12, opacity: 0.18, interactive: false, lineCap: 'round', lineJoin: 'round' }));
    group.addLayer(L.polyline(segs, { pane: 'foDistrict', color: '#fff', weight: 6, opacity: 0.95, interactive: false, lineCap: 'round', lineJoin: 'round' }));
    group.addLayer(L.polyline(segs, { pane: 'foDistrict', color: DISTRICT_LINE, weight: 2.4, opacity: 1, interactive: false, lineCap: 'round', lineJoin: 'round' }));
  }

  // ৪) নাম
  const lbl = (pt, html) => L.marker(pt, {
    pane: 'foLabels', interactive: false, keyboard: false,
    icon: L.divIcon({ className: '', html, iconSize: [0, 0], iconAnchor: [0, 0] }),
  });
  if (o.labels) {
    const pts = getLabelPoints(geo);
    Object.keys(pts.unions).forEach((en) => {
      const upId = getUnionUpazilaId(en);
      if (!upId) return;
      const m = lbl(pts.unions[en], `<div class="fo-un" style="--c:${deepen(upazilaColor(upId), 0.3)}">${esc(getUnionBn(en))}</div>`);
      unionLabels[en] = m;
      group.addLayer(m);
    });
    UPAZILAS.forEach((u) => {
      const pt = pts.upazilas[u.id];
      if (pt) group.addLayer(lbl(pt, `<div class="fo-up" style="--c:${upazilaColor(u.id)}"><i></i>${esc(u.name)}</div>`));
    });
  }

  // জুম অনুযায়ী কোন নাম দেখাবে
  const el = map.getContainer();
  const zoomClass = () => {
    const z = map.getZoom();
    el.classList.toggle('fo-z1', z < o.unionLabelZoom);
    el.classList.toggle('fo-z3', z >= o.upazilaHideZoom);
  };
  map.on('zoomend', zoomClass);

  const feniBounds = getFeniBounds(geo, 0);
  if (o.fit) map.fitBounds(feniBounds, { padding: [16, 16] });
  const unFree = o.freePan ? freePanToFeni(L, map, feniBounds) : null;
  zoomClass();

  function highlight(en) {
    if (selected && unionLayers[selected]) {
      unionLayers[selected].setStyle(baseStyle(selected));
      unionLabels[selected]?.getElement()?.querySelector('.fo-un')?.classList.remove('on');
    }
    selected = en && unionLayers[en] ? en : null;
    if (selected) {
      unionLayers[selected].setStyle(selStyle(selected));
      unionLayers[selected].bringToFront();
      const le = unionLabels[selected]?.getElement()?.querySelector('.fo-un');
      if (le) le.classList.add('on');
    }
  }

  return {
    geo,
    highlight,
    areaAt: (ll) => findAreaAt(ll.lat, ll.lng, geo),
    fitAll: () => map.flyToBounds(feniBounds, { padding: [16, 16], duration: 0.6 }),
    flyToUpazila: (id) => { const b = getUpazilaBounds(geo, id); if (b) map.flyToBounds(b, { padding: [20, 20], duration: 0.6 }); },
    remove: () => { group.remove(); map.off('zoomend', zoomClass); unFree && unFree(); el.classList.remove('fo-z1', 'fo-z3'); },
  };
}
