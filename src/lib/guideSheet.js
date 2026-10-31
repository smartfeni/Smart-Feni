// path: src/lib/guideSheet.js
// ============================================================
// গাইড শিট (শেয়ার্ড) — প্রতি পেজে "কিভাবে ব্যবহার করবেন" ম্যানুয়াল
//
// কী করে: ⓘ বাটনে ট্যাপ করলে নিচ থেকে একটা শিট ওঠে। প্রতি ধাপে ওপরে ১ লাইনের
// নির্দেশনা, নিচে কোড দিয়ে আঁকা মক-স্ক্রিন (আসল স্ক্রিনশট নয়), আর যেখানে
// ক্লিক করতে হবে সেখানে কমলা pulsing মার্কার। UI বদলালে শুধু steps ডেটা বদলাতে হয়।
//
// ব্যবহার (পেজে): src/components/delivery/GuideSheet.astro কম্পোনেন্ট দিয়ে।
//   <GuideSheet id="customer-drop" title="অর্ডারের নিয়মাবলি" subtitle="ধাপ ১ · ড্রপ লোকেশন"
//     showButton steps={[{ caption: '...', blocks: [ ... ] }]} />
//   অন্য কোনো বাটন থেকেও খোলা যায়: data-sf-guide-open="customer-drop"
//   কোড থেকে: window.SFGuide.open('customer-drop')
//
// steps[i] = { caption: 'ধাপের ১ লাইনের নির্দেশনা', blocks: [ব্লক...] }
// ব্লকের ধরন (kind) — সবগুলোতে `tap: true` বা `tap: 'লেবেল'` দিলে ওই জায়গায় মার্কার বসে:
//   map      { h?: px, marker?: { x: 0-100, y: 0-100, label?: text, tap? }, area?: true }
//   stepper  { active: 0-based, labels?: [text, text, text] }
//   row      { cols: [ব্লক, ব্লক, ...] }          (সমান কলাম)
//   field    { text, muted?, chevron?, tap? }
//   textarea { text, tap? }
//   button   { text, primary?, tap? }
//   cta      { text, tap? }                         (বড় কমলা বাটন)
//   title    { text }          text { text, muted? }
//   chips    { items: [text...], active?: index, tap? }
//   tabs     { items: [text...], active?: index, tap? }
//   card     { title?, lines?: [text...], badge?, tap? }
//   item     { name, price?, qty?, tap? }           (দোকানের আইটেম সারি)
//   counter  { value, tap? }                        (− ২ +)
//   notice   { text }                               (কমলা নোটিশ)
//   spacer   {}                                     (বাকি জায়গা ঠেলে নিচে নামায়)
//
// নিরাপত্তা: সব টেক্সট textContent দিয়ে বসে (innerHTML নয়)।
// Android back বাটন: native-bridge.js এর overlay নিয়ম (.sfg-overlay.open +
// "বন্ধ" লেখা close বাটন) মেনে নিজে থেকেই শিট বন্ধ করে।
// ============================================================

import { supabase } from './supabase.js';

const registry = new Map(); // id -> { title, subtitle, steps, firstVisit }
let root = null;            // একটাই শিট DOM, সব গাইড এটাই ব্যবহার করে
let state = null;           // { id, step, opener, prevOverflow }
let inited = false;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_STEPS = 12;
const SEEN_PREFIX = 'sf_guide_seen_';

function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

// ---------------- মক-স্ক্রিনের ব্লক ----------------

function applyTap(node, tap) {
  if (!tap) return node;
  node.classList.add('sfg-tap');
  if (typeof tap === 'string' && tap.trim()) {
    node.appendChild(el('span', 'sfg-pin', tap.trim().slice(0, 14)));
  }
  return node;
}

function chevronIcon() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', '14');
  svg.setAttribute('height', '14');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', '#5B6B86');
  svg.setAttribute('stroke-width', '2.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M6 9l6 6 6-6');
  svg.appendChild(path);
  return svg;
}

// কোডে আঁকা সরল ম্যাপ (রাস্তা + নদী); এখানে শুধু কনস্ট্যান্ট SVG, ইউজারের লেখা নেই
const MAP_SVG =
  '<svg viewBox="0 0 390 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">' +
  '<rect width="390" height="360" fill="#E9EFE6"/>' +
  '<path d="M-10 250 C80 210 150 280 240 240 S380 190 410 210" stroke="#BFD9EE" stroke-width="26" fill="none"/>' +
  '<path d="M0 120 L390 160 M120 0 L170 360 M260 0 L230 360 M0 300 L390 280" stroke="#fff" stroke-width="9" fill="none"/>' +
  '</svg>';

const AREA_SVG =
  '<svg viewBox="0 0 390 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" class="sfg-area">' +
  '<polygon points="95,90 280,75 330,190 250,290 110,270 70,170" fill="#FF6B35" fill-opacity=".14" stroke="#FF6B35" stroke-width="2.5" stroke-dasharray="7 5"/>' +
  '</svg>';

function pct(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

const BLOCKS = {
  map(b) {
    const node = el('div', 'sfg-b-map');
    const h = Number(b.h);
    node.style.height = (Number.isFinite(h) ? Math.max(80, Math.min(300, h)) : 150) + 'px';
    node.innerHTML = MAP_SVG + (b.area ? AREA_SVG : ''); // কনস্ট্যান্ট SVG
    if (b.marker) {
      const m = el('div', 'sfg-marker');
      m.style.left = pct(b.marker.x, 50) + '%';
      m.style.top = pct(b.marker.y, 50) + '%';
      const pin = document.createElementNS(SVG_NS, 'svg');
      pin.setAttribute('width', '26');
      pin.setAttribute('height', '32');
      pin.setAttribute('viewBox', '0 0 40 50');
      pin.setAttribute('aria-hidden', 'true');
      const p1 = document.createElementNS(SVG_NS, 'path');
      p1.setAttribute('d', 'M20 48 S4 32 4 19 a16 16 0 0 1 32 0 c0 13 -16 29 -16 29z');
      p1.setAttribute('fill', '#1B2A4A');
      const c1 = document.createElementNS(SVG_NS, 'circle');
      c1.setAttribute('cx', '20');
      c1.setAttribute('cy', '19');
      c1.setAttribute('r', '7');
      c1.setAttribute('fill', '#FF6B35');
      pin.appendChild(p1);
      pin.appendChild(c1);
      m.appendChild(pin);
      if (b.marker.label) m.appendChild(el('span', 'sfg-chip sfg-marker-label', b.marker.label));
      applyTap(m, b.marker.tap);
      node.appendChild(m);
    }
    return node;
  },

  stepper(b) {
    const labels = Array.isArray(b.labels) && b.labels.length ? b.labels : ['১ ড্রপ', '২ পিকআপ', '৩ কনফার্ম'];
    const node = el('div', 'sfg-b-stepper');
    labels.forEach((t, i) => {
      node.appendChild(el('span', 'sfg-step' + (i === Number(b.active) ? ' is-active' : ''), t));
    });
    return node;
  },

  row(b) {
    const cols = Array.isArray(b.cols) ? b.cols : [];
    const node = el('div', 'sfg-b-row');
    node.style.gridTemplateColumns = 'repeat(' + Math.max(1, cols.length) + ', minmax(0, 1fr))';
    cols.forEach((c) => {
      const child = renderBlock(c);
      if (child) node.appendChild(child);
    });
    return node;
  },

  field(b) {
    const node = el('div', 'sfg-b-field' + (b.muted ? ' is-muted' : ''));
    node.appendChild(el('span', 'sfg-grow', b.text));
    if (b.chevron) node.appendChild(chevronIcon());
    return applyTap(node, b.tap);
  },

  textarea(b) {
    return applyTap(el('div', 'sfg-b-field sfg-b-textarea is-muted', b.text), b.tap);
  },

  button(b) {
    return applyTap(el('div', 'sfg-b-button' + (b.primary ? ' is-primary' : ''), b.text), b.tap);
  },

  cta(b) {
    return applyTap(el('div', 'sfg-b-cta', b.text), b.tap);
  },

  title(b) {
    return el('div', 'sfg-b-title', b.text);
  },

  text(b) {
    return el('div', 'sfg-b-text' + (b.muted ? ' is-muted' : ''), b.text);
  },

  chips(b) {
    const node = el('div', 'sfg-b-chips');
    (Array.isArray(b.items) ? b.items : []).forEach((t, i) => {
      node.appendChild(el('span', 'sfg-chip' + (i === Number(b.active) ? ' is-active' : ''), t));
    });
    return applyTap(node, b.tap);
  },

  tabs(b) {
    const node = el('div', 'sfg-b-tabs');
    (Array.isArray(b.items) ? b.items : []).forEach((t, i) => {
      node.appendChild(el('span', 'sfg-tab' + (i === Number(b.active) ? ' is-active' : ''), t));
    });
    return applyTap(node, b.tap);
  },

  card(b) {
    const node = el('div', 'sfg-b-card');
    if (b.title || b.badge) {
      const head = el('div', 'sfg-card-head');
      if (b.title) head.appendChild(el('span', 'sfg-card-title', b.title));
      if (b.badge) head.appendChild(el('span', 'sfg-chip', b.badge));
      node.appendChild(head);
    }
    (Array.isArray(b.lines) ? b.lines : []).forEach((t) => node.appendChild(el('div', 'sfg-card-line', t)));
    return applyTap(node, b.tap);
  },

  item(b) {
    const node = el('div', 'sfg-b-item');
    node.appendChild(el('span', 'sfg-item-tile'));
    const mid = el('div', 'sfg-grow');
    mid.appendChild(el('div', 'sfg-item-name', b.name));
    if (b.price) mid.appendChild(el('div', 'sfg-item-sub', b.price + (b.qty ? ' × ' + b.qty : '')));
    node.appendChild(mid);
    return applyTap(node, b.tap);
  },

  counter(b) {
    const node = el('div', 'sfg-b-counter');
    node.appendChild(el('span', 'sfg-count-btn', '−'));
    node.appendChild(el('span', 'sfg-count-val', b.value !== undefined ? b.value : '১'));
    node.appendChild(el('span', 'sfg-count-btn is-plus', '+'));
    return applyTap(node, b.tap);
  },

  notice(b) {
    return el('div', 'sfg-b-notice', b.text);
  },

  spacer() {
    return el('div', 'sfg-b-spacer');
  },
};

function renderBlock(block) {
  if (!block || typeof block !== 'object') return null;
  const fn = BLOCKS[block.kind];
  if (!fn) {
    if (typeof console !== 'undefined') console.warn('[guideSheet] অজানা ব্লক:', block.kind);
    return null;
  }
  return fn(block);
}

// ---------------- শিটের কাঠামো ----------------

function buildRoot() {
  const overlay = el('div', 'sfg-overlay');
  overlay.id = 'sfg-root';

  const backdrop = el('div', 'sfg-backdrop');
  backdrop.addEventListener('click', closeGuide);

  const sheet = el('div', 'sfg-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-labelledby', 'sfg-title');

  sheet.appendChild(el('div', 'sfg-grab'));

  const head = el('div', 'sfg-head');
  const titles = el('div', 'sfg-titles');
  const h2 = el('h2', 'sfg-title');
  h2.id = 'sfg-title';
  const sub = el('p', 'sfg-sub');
  sub.id = 'sfg-sub';
  titles.appendChild(h2);
  titles.appendChild(sub);
  const close = el('button', 'sfg-close');
  close.type = 'button';
  close.id = 'sfg-close';
  close.setAttribute('aria-label', 'গাইড বন্ধ করুন');
  close.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#1B2A4A" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  close.addEventListener('click', closeGuide);
  head.appendChild(titles);
  head.appendChild(close);
  sheet.appendChild(head);

  // ঐচ্ছিক টিউটোরিয়াল ভিডিও: videoTopic-এর ভিডিও থাকলে তবেই বাটনটা দেখায়
  const vidBtn = el('button', 'sfg-vidbtn', '▶ ভিডিওতে দেখুন');
  vidBtn.type = 'button';
  vidBtn.id = 'sfg-vidbtn';
  vidBtn.hidden = true;
  sheet.appendChild(vidBtn);

  const vidPane = el('div', 'sfg-vidpane');
  const vidBox = el('div', 'sfg-vidbox');
  vidBox.id = 'sfg-vidbox';
  vidPane.appendChild(vidBox);
  const vidBack = el('button', 'sfg-btn sfg-prev sfg-vidback', 'ধাপে ধাপে দেখুন');
  vidBack.type = 'button';
  vidBack.addEventListener('click', hideVideo);
  vidPane.appendChild(vidBack);
  sheet.appendChild(vidPane);

  const caption = el('div', 'sfg-caption');
  caption.id = 'sfg-caption';
  caption.setAttribute('aria-live', 'polite');
  sheet.appendChild(caption);

  const stage = el('div', 'sfg-stage');
  const phone = el('div', 'sfg-phone');
  phone.id = 'sfg-phone';
  stage.appendChild(phone);
  sheet.appendChild(stage);

  const dots = el('div', 'sfg-dots');
  dots.id = 'sfg-dots';
  sheet.appendChild(dots);

  const foot = el('div', 'sfg-foot');
  const prev = el('button', 'sfg-btn sfg-prev', 'আগের');
  prev.type = 'button';
  prev.id = 'sfg-prev';
  prev.addEventListener('click', () => go(state.step - 1));
  const next = el('button', 'sfg-btn sfg-next', 'পরের ধাপ');
  next.type = 'button';
  next.id = 'sfg-next';
  next.addEventListener('click', () => {
    const cfg = registry.get(state.id);
    if (state.step >= cfg.steps.length - 1) closeGuide();
    else go(state.step + 1);
  });
  foot.appendChild(prev);
  foot.appendChild(next);
  sheet.appendChild(foot);

  overlay.appendChild(backdrop);
  overlay.appendChild(sheet);
  document.body.appendChild(overlay);
  return overlay;
}

function renderStep() {
  const cfg = registry.get(state.id);
  const step = cfg.steps[state.step];

  root.querySelector('#sfg-caption').textContent = step.caption || '';

  const phone = root.querySelector('#sfg-phone');
  phone.textContent = '';
  (Array.isArray(step.blocks) ? step.blocks : []).forEach((b) => {
    const node = renderBlock(b);
    if (node) phone.appendChild(node);
  });

  const dots = root.querySelector('#sfg-dots');
  dots.textContent = '';
  cfg.steps.forEach((_, i) => {
    const d = el('button', 'sfg-dot' + (i === state.step ? ' is-active' : ''));
    d.type = 'button';
    d.setAttribute('aria-label', 'ধাপ ' + (i + 1));
    if (i === state.step) d.setAttribute('aria-current', 'step');
    d.appendChild(el('span', 'sfg-dot-mark'));
    d.addEventListener('click', () => go(i));
    dots.appendChild(d);
  });

  const prev = root.querySelector('#sfg-prev');
  const next = root.querySelector('#sfg-next');
  prev.disabled = state.step === 0;
  next.textContent = state.step >= cfg.steps.length - 1 ? 'বুঝেছি' : 'পরের ধাপ';
  dots.hidden = cfg.steps.length < 2;
}

function go(n) {
  if (!state) return;
  const cfg = registry.get(state.id);
  const clamped = Math.max(0, Math.min(cfg.steps.length - 1, n));
  state.step = clamped;
  renderStep();
}

// ---------------- টিউটোরিয়াল ভিডিও (ঐচ্ছিক) ----------------
// cfg.videoTopic থাকলে tutorial_videos টেবিল থেকে ওই টপিকের YouTube লিংক আনে।
// লিংক থাকলে শিটে "ভিডিওতে দেখুন" বাটন আসে; না থাকলে গাইড আগের মতোই চলে।
// ভিডিও বাটনে ট্যাপ করার আগে কোনো ভিডিও ডেটা লোড হয় না। লিংক বদলায় /admin/tutorials থেকে।

const videoCache = new Map(); // topic -> { id, title } | null

function ytId(url) {
  try {
    const u = new URL(String(url || '').trim());
    const h = u.hostname.replace(/^(www\.|m\.)/, '');
    let id = null;
    if (h === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (h === 'youtube.com' || h === 'youtube-nocookie.com') {
      if (u.pathname === '/watch') id = u.searchParams.get('v');
      else {
        const m = u.pathname.match(/^\/(shorts|embed|live)\/([^/?]+)/);
        if (m) id = m[2];
      }
    }
    return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? id : null;
  } catch (err) {
    return null;
  }
}

async function loadVideo(topic) {
  if (videoCache.has(topic)) return videoCache.get(topic);
  try {
    const { data, error } = await supabase
      .from('tutorial_videos')
      .select('title, video_url')
      .eq('topic_key', topic)
      .eq('is_active', true)
      .maybeSingle();
    if (error) return null;
    const id = data ? ytId(data.video_url) : null;
    const out = id ? { id, title: data.title || '' } : null;
    videoCache.set(topic, out);
    return out;
  } catch (err) {
    return null;
  }
}

function hideVideo() {
  if (!root) return;
  root.querySelector('.sfg-sheet').classList.remove('sfg-vmode');
  root.querySelector('#sfg-vidbox').textContent = ''; // iframe মুছলে ভিডিও থামে
}

function resetVideo() {
  if (!root) return;
  hideVideo();
  root.querySelector('#sfg-vidbtn').hidden = true;
}

function showVideo(v) {
  const box = root.querySelector('#sfg-vidbox');
  box.textContent = '';
  const f = document.createElement('iframe');
  f.src = 'https://www.youtube-nocookie.com/embed/' + v.id + '?rel=0&playsinline=1&autoplay=1';
  f.title = v.title || 'টিউটোরিয়াল ভিডিও';
  f.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
  f.allowFullscreen = true;
  f.referrerPolicy = 'strict-origin-when-cross-origin';
  box.appendChild(f);
  root.querySelector('.sfg-sheet').classList.add('sfg-vmode');
}

function setupVideo(cfg) {
  resetVideo();
  if (!cfg.videoTopic) return;
  const gid = state.id;
  loadVideo(cfg.videoTopic).then((v) => {
    if (!v || !state || state.id !== gid) return;
    const btn = root.querySelector('#sfg-vidbtn');
    btn.onclick = () => showVideo(v);
    btn.hidden = false;
  });
}

// ---------------- খোলা / বন্ধ ----------------

function focusables() {
  return Array.from(root.querySelectorAll('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(
    (n) => n.getClientRects().length > 0
  );
}

function onKeydown(e) {
  if (!state) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeGuide();
    return;
  }
  if (e.key === 'ArrowRight') go(state.step + 1);
  if (e.key === 'ArrowLeft') go(state.step - 1);
  if (e.key === 'Tab') {
    const list = focusables();
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
}

export function openGuide(id, opener) {
  const cfg = registry.get(id);
  if (!cfg || !cfg.steps.length) return false;
  if (!root) root = buildRoot();

  state = {
    id,
    step: 0,
    opener: opener || document.activeElement,
    prevOverflow: document.body.style.overflow,
  };
  root.querySelector('#sfg-title').textContent = cfg.title;
  const sub = root.querySelector('#sfg-sub');
  sub.textContent = cfg.subtitle || '';
  sub.hidden = !cfg.subtitle;
  renderStep();
  setupVideo(cfg);

  document.body.style.overflow = 'hidden';
  root.classList.add('open');
  document.addEventListener('keydown', onKeydown);
  root.querySelector('#sfg-close').focus();

  try {
    localStorage.setItem(SEEN_PREFIX + id, '1');
  } catch (err) {
    // স্টোরেজ বন্ধ থাকলেও গাইড কাজ করবে
  }
  return true;
}

export function closeGuide() {
  if (!state || !root) return;
  resetVideo();
  root.classList.remove('open');
  document.body.style.overflow = state.prevOverflow || '';
  document.removeEventListener('keydown', onKeydown);
  const opener = state.opener;
  state = null;
  if (opener && typeof opener.focus === 'function' && document.contains(opener)) {
    try {
      opener.focus();
    } catch (err) {
      // ফোকাস ফেরানো না গেলে সমস্যা নেই
    }
  }
}

// ---------------- রেজিস্ট্রি ও শুরু ----------------

function sanitizeConfig(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const steps = (Array.isArray(raw.steps) ? raw.steps : [])
    .filter((s) => s && typeof s === 'object')
    .slice(0, MAX_STEPS)
    .map((s) => ({
      caption: typeof s.caption === 'string' ? s.caption : '',
      blocks: Array.isArray(s.blocks) ? s.blocks : [],
    }));
  if (!steps.length) return null;
  return {
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'ব্যবহারের নিয়ম',
    subtitle: typeof raw.subtitle === 'string' ? raw.subtitle : '',
    firstVisit: raw.firstVisit === true,
    videoTopic: typeof raw.videoTopic === 'string' ? raw.videoTopic.slice(0, 40) : '',
    steps,
  };
}

export function registerGuide(id, config) {
  const clean = sanitizeConfig(config);
  if (!id || !clean) return false;
  registry.set(String(id), clean);
  return true;
}

function hasSeen(id) {
  try {
    return localStorage.getItem(SEEN_PREFIX + id) === '1';
  } catch (err) {
    return true; // স্টোরেজ না থাকলে জোর করে খুলব না
  }
}

function scanDataScripts() {
  document.querySelectorAll('script.sfg-data').forEach((node) => {
    if (node.dataset.sfgDone === '1') return;
    node.dataset.sfgDone = '1';
    const id = node.getAttribute('data-sf-guide-id');
    try {
      const ok = registerGuide(id, JSON.parse(node.textContent || '{}'));
      if (ok && registry.get(id).firstVisit && !hasSeen(id)) {
        setTimeout(() => openGuide(id, null), 600);
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[guideSheet] ডেটা পড়া যায়নি:', id);
    }
  });
}

export function initGuideSheets() {
  if (typeof document === 'undefined') return;
  scanDataScripts();
  if (inited) return;
  inited = true;

  // যেকোনো [data-sf-guide-open="id"] এলিমেন্টে ক্লিক করলে গাইড খোলে
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target.closest('[data-sf-guide-open]') : null;
    if (!target) return;
    e.preventDefault();
    openGuide(target.getAttribute('data-sf-guide-open'), target);
  });

  window.SFGuide = { open: (id) => openGuide(id, null), close: closeGuide, register: registerGuide };
}
