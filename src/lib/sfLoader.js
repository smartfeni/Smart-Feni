// ============================================================
// Smart Feni — শেয়ার্ড লোডিং হেল্পার
//
// BaseLayout থেকে initSFLoader() একবার কল হয়, তারপর সব পেজে পাওয়া যায়:
//
//   window.SFLoader.markup({ size: 'sm'|'md'|'lg', tone: 'dark'|'current' })
//       -> innerHTML-এ বসানোর জন্য S-লুপ লোডারের HTML স্ট্রিং
//   window.SFLoader.block('লোড হচ্ছে…', 'md')
//       -> সেকশন/লিস্টের মাঝখানের লোডিং প্লেসহোল্ডার HTML
//
//   window.SFLoading.show('লেবেল')  / .hide()
//       -> ফুলস্ক্রিন ওভারলে (১৫০ms-এর কম লাগলে দেখায় না, নেস্টেড কল নিরাপদ)
//   window.SFLoading.run(asyncFn, 'লেবেল')
//       -> show -> asyncFn -> hide (ফেইল করলেও hide হয়)
//   window.SFLoading.wrap(btn, asyncFn, { label: 'অপেক্ষা করুন…' })
//       -> বাটনে লোডার, চলাকালে পরের ক্লিক/সাবমিট ইগনোর
//   window.SFLoading.reset()
//       -> জোর করে সব বন্ধ (ফেইলসেফ)
// ============================================================

const PATH = 'M14 44C6 30 20 12 40 20C58 28 62 44 80 44C94 44 96 26 86 22';
const SHOW_DELAY_MS = 150;
const MAX_VISIBLE_MS = 90000; // ওভারলে যেন কখনো চিরতরে আটকে না থাকে

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

export function loaderMarkup(opts = {}) {
  const size = ['sm', 'md', 'lg'].includes(opts.size) ? opts.size : 'md';
  const tone = ['dark', 'current'].includes(opts.tone) ? opts.tone : '';
  const cls = 'sf-loader sf-loader-' + size + (tone ? ' sf-loader-' + tone : '');
  const a11y = opts.decorative
    ? 'aria-hidden="true"'
    : 'role="status" aria-label="' + esc(opts.label || 'লোড হচ্ছে') + '"';
  return (
    '<span class="' + cls + '" ' + a11y + '>' +
    '<svg viewBox="0 0 100 60" focusable="false" aria-hidden="true">' +
    '<path class="sf-l-track" pathLength="200" d="' + PATH + '"/>' +
    '<path class="sf-l-run" pathLength="200" d="' + PATH + '"/>' +
    '</svg></span>'
  );
}

export function blockMarkup(label = 'লোড হচ্ছে…', size = 'md') {
  return (
    '<div class="sf-loader-block" role="status">' +
    loaderMarkup({ size, decorative: true }) +
    (label ? '<span>' + esc(label) + '</span>' : '') +
    '</div>'
  );
}

export function initSFLoader() {
  if (typeof window === 'undefined' || window.__sfLoaderInit) return;
  window.__sfLoaderInit = true;

  // ---------- ফুলস্ক্রিন ওভারলে ----------
  let overlay = null;
  let labelEl = null;
  let count = 0;
  let visible = false;
  let showTimer = null;
  let failTimer = null;
  let currentLabel = '';

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement('div');
    overlay.className = 'sf-loading-overlay';
    overlay.setAttribute('aria-live', 'polite');
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = loaderMarkup({ size: 'lg' }) + '<div class="sf-loading-label"></div>';
    labelEl = overlay.querySelector('.sf-loading-label');
    document.body.appendChild(overlay);
    return overlay;
  }

  function updateLabel() {
    if (labelEl) labelEl.textContent = currentLabel;
  }

  function reveal() {
    const o = ensureOverlay();
    updateLabel();
    o.setAttribute('aria-hidden', 'false');
    // একটা ফ্রেম পরে ক্লাস বসালে ট্রানজিশন কাজ করে
    requestAnimationFrame(() => o.classList.add('sf-show'));
    visible = true;
    clearTimeout(failTimer);
    failTimer = setTimeout(reset, MAX_VISIBLE_MS);
  }

  function finish() {
    clearTimeout(showTimer);
    showTimer = null;
    clearTimeout(failTimer);
    failTimer = null;
    if (overlay) {
      overlay.classList.remove('sf-show');
      overlay.setAttribute('aria-hidden', 'true');
    }
    visible = false;
  }

  function show(label) {
    count += 1;
    currentLabel = label || '';
    if (visible) {
      updateLabel();
      return;
    }
    if (showTimer) return;
    showTimer = setTimeout(() => {
      showTimer = null;
      if (count > 0) reveal();
    }, SHOW_DELAY_MS);
  }

  function hide() {
    if (count > 0) count -= 1;
    if (count === 0) finish();
  }

  function reset() {
    count = 0;
    finish();
  }

  async function run(fn, label) {
    show(label);
    try {
      return await fn();
    } finally {
      hide();
    }
  }

  // ---------- বাটন লোডিং ----------
  function wrap(btn, fn, opts = {}) {
    const exec = () => {
      try {
        return Promise.resolve(fn());
      } catch (err) {
        return Promise.reject(err);
      }
    };

    // বাটন না দিলে শুধু ফাংশন চালাও
    if (!btn || btn.nodeType !== 1) return exec();

    // ইতিমধ্যে চলছে: পরের ক্লিক ইগনোর
    if (btn.dataset.sfBusy === '1') return Promise.resolve(undefined);
    btn.dataset.sfBusy = '1';

    const prevMinWidth = btn.style.minWidth;
    const width = btn.offsetWidth;
    if (width) btn.style.minWidth = width + 'px'; // লেখা বদলালে বাটন যেন লাফ না দেয়

    // আসল কন্টেন্ট সরিয়ে রাখি (নোড অক্ষত থাকে, পরে ফেরত দেব)
    const saved = document.createDocumentFragment();
    while (btn.firstChild) saved.appendChild(btn.firstChild);

    const holder = document.createElement('span');
    holder.className = 'sf-btn-busy-content';
    holder.innerHTML = loaderMarkup({ size: 'sm', tone: 'current', decorative: true });
    const label = opts.label === undefined ? 'অপেক্ষা করুন…' : opts.label;
    if (label) {
      const text = document.createElement('span');
      text.textContent = label;
      holder.appendChild(text);
    }
    btn.appendChild(holder);

    btn.classList.add('sf-btn-busy');
    btn.setAttribute('aria-busy', 'true');
    btn.setAttribute('aria-disabled', 'true');

    const restore = () => {
      delete btn.dataset.sfBusy;
      btn.classList.remove('sf-btn-busy');
      btn.removeAttribute('aria-busy');
      btn.removeAttribute('aria-disabled');
      btn.style.minWidth = prevMinWidth;
      // পেজের কোড নিজে বাটনের লেখা বদলে ফেললে (যেমন "সম্পন্ন") সেটা মুছব না
      if (holder.parentNode === btn) {
        btn.removeChild(holder);
        btn.appendChild(saved);
      }
    };

    return exec().finally(restore);
  }

  // ব্যস্ত বাটনের ক্লিক সবার আগে (capture) আটকে দিই; এতে নিচের কার্ডের ক্লিকও ট্রিগার হয় না
  document.addEventListener('click', (e) => {
    const target = e.target;
    const busy = target && target.closest ? target.closest('[data-sf-busy="1"]') : null;
    if (busy) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // ব্যস্ত সাবমিট বাটন থাকলে ফর্ম আবার সাবমিট হবে না (Enter চাপলেও)
  document.addEventListener('submit', (e) => {
    const form = e.target;
    if (form && form.querySelector && form.querySelector('[data-sf-busy="1"]')) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // ব্যাক বাটন/bfcache থেকে পেজ ফিরলে ওভারলে আটকে থাকা এড়াতে
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) reset();
  });

  // ---------- অটো-আপগ্রেড: পুরনো স্পিনার ও "…হচ্ছে..." বাটন ----------
  // বাদ দিতে চাইলে এলিমেন্টে (বা তার কোনো প্যারেন্টে) data-sf-loader="off" দাও।
  const OFF = '[data-sf-loader="off"]';
  const SPINNER_SEL = 'i.fa-spin, i.fa-spinner, [class*="spinner"]';
  const LOADING_TEXT = /(\.{2,}|…)\s*$/;
  const SVG_INNER =
    '<svg viewBox="0 0 100 60" focusable="false" aria-hidden="true">' +
    '<path class="sf-l-track" pathLength="200" d="' + PATH + '"/>' +
    '<path class="sf-l-run" pathLength="200" d="' + PATH + '"/>' +
    '</svg>';

  function sizeFromFont(px) {
    if (!(px > 0)) return 'sm';
    if (px <= 18) return 'sm';
    if (px <= 28) return 'md';
    return 'lg';
  }

  function sizeFromWidth(px) {
    if (!(px > 0)) return 'md';
    if (px <= 26) return 'sm';
    if (px <= 44) return 'md';
    return 'lg';
  }

  function upgradeSpinner(el) {
    if (!el || el.nodeType !== 1 || el.dataset.sfUpgraded === '1') return;
    if (el.closest(OFF)) return;
    if (el.closest('.sf-loader, .sf-auto-spinner, .sf-loading-overlay, .sf-ptr-indicator')) return;

    if (el.tagName === 'I') {
      if (!el.classList.contains('fa-spin') && !el.classList.contains('fa-spinner')) return;
      const fontSize = parseFloat(getComputedStyle(el).fontSize);
      Array.from(el.classList).forEach((c) => {
        if (/^fa([a-z]?|-.+)$/.test(c)) el.classList.remove(c);
      });
      el.classList.add('sf-loader', 'sf-loader-' + sizeFromFont(fontSize), 'sf-loader-current');
      el.setAttribute('role', 'status');
      el.setAttribute('aria-label', 'লোড হচ্ছে');
      el.innerHTML = SVG_INNER;
    } else {
      // ভেতরে কিছু থাকলে (কন্টেইনার বা লেখাসহ) ছোঁব না, শুধু খালি spinner div
      if (el.children.length || (el.textContent || '').trim()) return;
      const width = parseFloat(getComputedStyle(el).width);
      el.classList.add('sf-auto-spinner', 'sf-as-' + sizeFromWidth(width));
      el.setAttribute('role', 'status');
      el.setAttribute('aria-label', 'লোড হচ্ছে');
      el.innerHTML = SVG_INNER;
    }
    el.dataset.sfUpgraded = '1';
  }

  function scanSpinners(root) {
    if (!root || root.nodeType !== 1) return;
    if (root.matches && root.matches(SPINNER_SEL)) upgradeSpinner(root);
    if (root.querySelectorAll) root.querySelectorAll(SPINNER_SEL).forEach(upgradeSpinner);
  }

  function syncButton(btn) {
    if (!btn || btn.tagName !== 'BUTTON') return;
    const existing = btn.querySelector(':scope > .sf-btn-auto');
    let should = false;
    if (
      btn.disabled &&
      btn.dataset.sfBusy !== '1' &&
      !btn.closest(OFF) &&
      !btn.querySelector('.sf-loader:not(.sf-btn-auto), .sf-auto-spinner')
    ) {
      should = LOADING_TEXT.test((btn.textContent || '').trim());
    }
    if (should && !existing) {
      const span = document.createElement('span');
      span.className = 'sf-loader sf-loader-sm sf-loader-current sf-btn-auto';
      span.setAttribute('aria-hidden', 'true');
      span.innerHTML = SVG_INNER;
      btn.insertBefore(span, btn.firstChild);
    } else if (!should && existing) {
      existing.remove();
    }
  }

  const pending = new Set();
  let rafId = 0;

  function flush() {
    rafId = 0;
    const nodes = Array.from(pending);
    pending.clear();
    nodes.forEach((n) => {
      if (!n.isConnected) return;
      scanSpinners(n);
      const own = n.closest ? n.closest('button') : null;
      if (own) syncButton(own);
      if (n.querySelectorAll) n.querySelectorAll('button:disabled').forEach(syncButton);
    });
  }

  function queue(node) {
    if (node && node.nodeType === 1) pending.add(node);
    if (!rafId) rafId = requestAnimationFrame(flush);
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') {
        queue(r.target);
      } else if (r.type === 'characterData') {
        queue(r.target.parentElement);
      } else {
        r.addedNodes.forEach(queue);
        const host = r.target && r.target.closest ? r.target.closest('button') : null;
        if (host) queue(host);
      }
    }
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['disabled'],
    characterData: true,
  });

  queue(document.documentElement);

  window.SFLoader = { markup: loaderMarkup, block: blockMarkup };
  window.SFLoading = { show, hide, run, wrap, reset };
}
