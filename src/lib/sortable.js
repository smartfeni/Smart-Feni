// path: src/lib/sortable.js
// ============================================================
// শেয়ার্ড: চেপে ধরে (long-press) টেনে ক্রম বদল — সাইটের সব reorder এটাই ব্যবহার করবে।
//
// ব্যবহার:
//   const stop = makeSortable(containerEl, {
//     itemSelector: '.row',          // container-এর সরাসরি সন্তান (ঐচ্ছিক)
//     idAttr: 'data-id',             // প্রতিটা আইটেমে আইডি অ্যাট্রিবিউট (ডিফল্ট data-id)
//     handle: '.grip',               // থাকলে শুধু ওই হ্যান্ডেল থেকে টানা যাবে (ঐচ্ছিক)
//     holdMs: 350,                   // কতক্ষণ চেপে ধরলে টানা শুরু (হ্যান্ডেল থাকলে ১৫০)
//     onChange: (ids, oldIds) => {}, // ছাড়ার পর ক্রম বদলালে নতুন আইডি তালিকা
//   });
//   stop(); // লিসেনার খুলতে
//
// ফোনে: আইটেম ~০.৩৫ সেকেন্ড চেপে ধরলে ভাইব্রেট করে ভেসে ওঠে, আঙুলের সাথে নড়ে;
// কিনারায় নিলে নিজে স্ক্রল করে। ধরার আগে আঙুল নড়লে সাধারণ স্ক্রল (টানা শুরু হয় না)।
// ডেস্কটপ: [data-sort-handle] বা handle থেকে মাউস দিয়ে সাথে সাথে টানা যায়।
// ফর্ম ফিল্ড (input/textarea/select) ও [data-no-drag] থেকে টানা শুরু হয় না।
// টানার পর ভুল ক্লিক আটকাতে ~০.৪৫ সেকেন্ড ক্লিক বন্ধ থাকে।
// ============================================================

let styleDone = false;

function injectStyle() {
  if (styleDone || typeof document === 'undefined') return;
  styleDone = true;
  const st = document.createElement('style');
  st.setAttribute('data-sf-sortable', '1');
  st.textContent =
    '.sfs > *{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;}' +
    '.sfs img{-webkit-user-drag:none;pointer-events:none;}' +
    '.sfs input,.sfs textarea{-webkit-user-select:text;user-select:text;}' +
    '.sfs-ph{opacity:.28;}' +
    '.sfs-ghost{background:#fff;border-radius:14px;box-shadow:0 10px 28px rgba(27,42,74,.28);opacity:.98;transform:scale(1.02);border-top-color:transparent !important;}' +
    'body.sfs-drag, body.sfs-drag *{-webkit-user-select:none !important;user-select:none !important;}';
  document.head.appendChild(st);
}

export function makeSortable(container, opts) {
  const o = opts || {};
  if (!container) return function () {};
  injectStyle();
  container.classList.add('sfs');

  const idAttr = o.idAttr || 'data-id';
  const holdMs = typeof o.holdMs === 'number' ? o.holdMs : (o.handle ? 150 : 350);

  let st = null;          // সক্রিয় টানার অবস্থা
  let pending = null;     // ধরে রাখার অপেক্ষায়
  let timer = null;
  let suppressUntil = 0;

  function getItems() {
    return Array.prototype.filter.call(container.children, function (el) {
      return !o.itemSelector || el.matches(o.itemSelector);
    });
  }
  function getIds() {
    return getItems().map(function (el) { return el.getAttribute(idAttr); });
  }
  function itemOf(t) {
    let el = t;
    while (el && el.parentElement !== container) el = el.parentElement;
    if (!el || el === container) return null;
    if (o.itemSelector && !el.matches(o.itemSelector)) return null;
    return el;
  }
  function blocked(t) {
    return !!(t.closest && t.closest('input,textarea,select,[data-no-drag]'));
  }

  // ---------- টানা শুরু / চলা / শেষ ----------
  function begin(item, x, y, target) {
    clearTimeout(timer);
    pending = null;
    const rect = item.getBoundingClientRect();
    const ghost = item.cloneNode(true);
    ghost.classList.add('sfs-ghost');
    ghost.style.cssText = 'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;width:' + rect.width + 'px;height:' + rect.height + 'px;margin:0;z-index:3000;pointer-events:none;box-sizing:border-box;';
    document.body.appendChild(ghost);
    item.classList.add('sfs-ph');
    document.body.classList.add('sfs-drag');
    st = { item: item, ghost: ghost, offY: y - rect.top, left: rect.left, x: x, y: y, startIds: getIds(), raf: 0, target: target };
    try { if (navigator.vibrate) navigator.vibrate(18); } catch (_) { /* উপেক্ষা */ }
    tick();
  }

  function move(x, y) {
    if (!st) return;
    st.x = x;
    st.y = y;
    st.ghost.style.top = (y - st.offY) + 'px';
  }

  function reposition() {
    if (!st) return;
    const others = getItems().filter(function (el) { return el !== st.item; });
    let before = null;
    for (let i = 0; i < others.length; i++) {
      const r = others[i].getBoundingClientRect();
      if (st.y < r.top + r.height / 2) { before = others[i]; break; }
    }
    if (before) {
      if (st.item.nextElementSibling !== before) container.insertBefore(st.item, before);
    } else if (container.lastElementChild !== st.item) {
      container.appendChild(st.item);
    }
  }

  function tick() {
    if (!st) return;
    const vh = window.innerHeight;
    let dy = 0;
    if (st.y < 90) dy = -Math.min(18, Math.ceil((90 - st.y) / 5));
    else if (st.y > vh - 90) dy = Math.min(18, Math.ceil((st.y - (vh - 90)) / 5));
    if (dy) window.scrollBy(0, dy);
    reposition();
    st.raf = requestAnimationFrame(tick);
  }

  function finish() {
    if (!st) return;
    const s = st;
    st = null;
    cancelAnimationFrame(s.raf);
    if (s.ghost.parentNode) s.ghost.parentNode.removeChild(s.ghost);
    s.item.classList.remove('sfs-ph');
    document.body.classList.remove('sfs-drag');
    suppressUntil = Date.now() + 450;
    detach(s.target);
    const ids = getIds();
    const changed = ids.length !== s.startIds.length || ids.some(function (v, i) { return v !== s.startIds[i]; });
    if (changed && typeof o.onChange === 'function') {
      try { o.onChange(ids, s.startIds); } catch (_) { /* উপেক্ষা */ }
    }
  }

  // ---------- টাচ ----------
  function onTouchMove(e) {
    const p = e.touches && e.touches[0];
    if (!p) return;
    if (!st) {
      if (pending && Math.hypot(p.clientX - pending.x, p.clientY - pending.y) > 8) cancelPending();
      return;
    }
    e.preventDefault();
    move(p.clientX, p.clientY);
  }
  function onTouchEnd() {
    if (st) finish();
    else cancelPending();
  }
  function attach(t) {
    t.addEventListener('touchmove', onTouchMove, { passive: false });
    t.addEventListener('touchend', onTouchEnd);
    t.addEventListener('touchcancel', onTouchEnd);
  }
  function detach(t) {
    if (!t) return;
    t.removeEventListener('touchmove', onTouchMove);
    t.removeEventListener('touchend', onTouchEnd);
    t.removeEventListener('touchcancel', onTouchEnd);
  }
  function cancelPending() {
    clearTimeout(timer);
    if (pending) detach(pending.target);
    pending = null;
  }

  function onTouchStart(e) {
    if (st || !e.touches || e.touches.length !== 1) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (o.handle) { if (!t.closest(o.handle)) return; }
    else if (blocked(t)) return;
    const item = itemOf(t);
    if (!item) return;
    cancelPending();
    const p = e.touches[0];
    pending = { item: item, x: p.clientX, y: p.clientY, target: t };
    attach(t);
    timer = setTimeout(function () {
      if (pending) begin(pending.item, pending.x, pending.y, pending.target);
    }, holdMs);
  }

  // ---------- মাউস (ডেস্কটপ) ----------
  function onMouseMove(e) { move(e.clientX, e.clientY); }
  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    finish();
  }
  function onMouseDown(e) {
    if (e.button !== 0 || st) return;
    const t = e.target;
    if (!(t instanceof Element)) return;
    const h = t.closest('[data-sort-handle]') || (o.handle ? t.closest(o.handle) : null);
    if (!h) return;
    const item = itemOf(h);
    if (!item) return;
    e.preventDefault();
    begin(item, e.clientX, e.clientY, null);
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }

  function onContextMenu(e) { if (pending || st) e.preventDefault(); }
  function onClickCapture(e) {
    if (Date.now() < suppressUntil) { e.preventDefault(); e.stopPropagation(); }
  }

  container.addEventListener('touchstart', onTouchStart, { passive: true });
  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('contextmenu', onContextMenu);
  container.addEventListener('click', onClickCapture, true);

  return function stop() {
    cancelPending();
    if (st) finish();
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('mousedown', onMouseDown);
    container.removeEventListener('contextmenu', onContextMenu);
    container.removeEventListener('click', onClickCapture, true);
    container.classList.remove('sfs');
  };
}
