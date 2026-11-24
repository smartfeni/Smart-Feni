// ============================================================
// অ্যাডমিন দ্রুত মেনু — /admin/* এর প্রতিটা পেজে ভাসমান ☰ বাটন
// ============================================================
// adminGuard.js অ্যাক্সেস অনুমোদন দেওয়ার পর এটা লোড করে (পেজ আলাদা করে বদলাতে হয় না)।
// - বাটনে ট্যাপ করলে নিচ থেকে শিট খোলে: সার্চ, শর্টকাট (প্রিয় → পেন্ডিং → সাম্প্রতিক, ২ সারি),
//   তারপর গ্রুপ ধরে সব পেজ। যে পেজে আছো সেটা চিহ্নিত।
// - ড্যাশবোর্ডে (/admin) বাটন আসে না (সেখানে সবই আছে), কিন্তু সাম্প্রতিক তালিকা সেখানেও আপডেট হয় না —
//   শুধু অন্য পেজ খুললে সেই পেজ "সাম্প্রতিক"-এ যোগ হয়।
// - পারমিশন: রোলওয়ালা স্টাফ শুধু নিজের এলাকার পেজ দেখে (adminAreaOfPath + access.can),
//   বাকিরা adminOnly পেজ বাদে সব। মেনু ফেইল করলে পেজ ভাঙে না।
// ============================================================

import { adminAreaOfPath } from './adminGuard.js';
import { ADMIN_GROUPS, ADMIN_PAGES } from './adminPages.js';
import { getFavs, getRecent, pushRecent, getBadges, bn } from './adminShortcuts.js';

const CSS = `
.sfqn-fab{position:fixed;left:0;top:0;z-index:1400;width:56px;height:56px;border:0;border-radius:18px;background:#1B2A4A;color:#fff;font-size:1.25rem;display:grid;place-items:center;cursor:grab;box-shadow:0 8px 20px rgba(27,42,74,.28);touch-action:none;user-select:none;-webkit-user-select:none;transition:left .18s ease,top .18s ease}
.sfqn-fab.is-drag{transition:none;cursor:grabbing;opacity:.92}
.sfqn-fab:focus-visible,.sfqn-sheet button:focus-visible,.sfqn-sheet a:focus-visible,.sfqn-sheet input:focus-visible{outline:2px solid #1B2A4A;outline-offset:2px}
.sfqn{position:fixed;inset:0;z-index:2000}
.sfqn[hidden]{display:none}
.sfqn-ov{position:absolute;inset:0;background:rgba(27,42,74,.5)}
.sfqn-sheet{position:absolute;left:0;right:0;bottom:0;margin:0 auto;max-width:560px;height:min(86vh,720px);background:#F6F8FB;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden;color:#1B2A4A;font-family:inherit}
.sfqn-grab{align-self:center;width:40px;height:4px;border-radius:99px;background:#C5CEDB;margin-top:8px}
.sfqn-hd{display:flex;align-items:center;justify-content:space-between;padding:4px 16px 0}
.sfqn-hd h2{margin:0;font-size:1.1rem;font-weight:700}
.sfqn-x{width:44px;height:44px;margin-right:-10px;border:0;background:transparent;color:#1B2A4A;font-size:1.05rem;cursor:pointer}
.sfqn-sr{display:flex;align-items:center;gap:8px;height:48px;margin:6px 16px 0;padding:0 14px;background:#fff;border:1px solid #D2DAE5;border-radius:14px;color:#566780}
.sfqn-sr input{flex:1;min-width:0;height:44px;border:0;outline:0;background:transparent;font:inherit;font-size:.95rem;color:#1B2A4A}
.sfqn-bd{flex:1;min-height:0;overflow-y:auto;padding:16px 16px calc(32px + env(safe-area-inset-bottom))}
.sfqn-sc{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-bottom:20px}
.sfqn-sc a{position:relative;height:52px;display:grid;place-items:center;background:#fff;border:1px solid #E3E8EF;border-radius:14px;color:#1B2A4A;font-size:1.1rem;text-decoration:none}
.sfqn-b{min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#FF6B35;color:#1B2A4A;font-size:.72rem;font-weight:800;line-height:1;display:inline-grid;place-items:center}
.sfqn-sc .sfqn-b{position:absolute;top:-6px;right:-6px;box-shadow:0 0 0 2px #F6F8FB}
.sfqn-g{margin:0 0 6px;font-size:.85rem;font-weight:600;color:#566780}
.sfqn-l{background:#fff;border:1px solid #E3E8EF;border-radius:16px;overflow:hidden;margin-bottom:18px}
.sfqn-r{display:flex;align-items:center;gap:12px;min-height:54px;padding:4px 14px 4px 10px;border-bottom:1px solid #EDF0F5;color:#1B2A4A;text-decoration:none}
.sfqn-r:last-child{border-bottom:0}
.sfqn-r[aria-current="page"]{background:#EEF2F7}
.sfqn-ic{flex:0 0 auto;width:36px;height:36px;border-radius:11px;background:#EEF2F7;display:grid;place-items:center;font-size:1rem}
.sfqn-n{flex:1;min-width:0;font-size:.95rem;font-weight:500;line-height:1.35}
.sfqn-here{font-size:.75rem;font-weight:600;color:#566780}
.sfqn-none{padding:24px 0;text-align:center;color:#566780}
`;

function allowed(page, role, access) {
  if (access && access.isStaff) {
    const area = adminAreaOfPath(page.href);
    return !!area && access.can(area + '.view');
  }
  return !page.adminOnly || role === 'admin';
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function icon(faClass) {
  const i = document.createElement('i');
  i.className = 'fas ' + faClass;
  i.setAttribute('aria-hidden', 'true');
  return i;
}

function badge(n) {
  return el('span', 'sfqn-b', n > 99 ? '৯৯+' : bn(n));
}

function build({ role, access }) {
  const path = location.pathname.replace(/\/+$/, '');
  const base = (path.match(/^\/admin\/[^/]+/) || [''])[0];

  // এই পেজ "সাম্প্রতিক"-এ যোগ (শুধু জানা পেজ)
  if (base && ADMIN_PAGES.some((p) => p.href === base)) pushRecent(base);

  // ড্যাশবোর্ডে ভাসমান বাটন লাগে না; দুইবার বসানোও বন্ধ
  if (path === '/admin' || path === '' || document.getElementById('sfQnFab')) return;

  const pages = ADMIN_PAGES.filter((p) => allowed(p, role, access));
  if (!pages.length) return;
  const byHref = {};
  pages.forEach((p) => { byHref[p.href] = p; });

  if (!document.getElementById('sfQnStyle')) {
    const st = document.createElement('style');
    st.id = 'sfQnStyle';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  const fab = el('button', 'sfqn-fab');
  fab.type = 'button';
  fab.id = 'sfQnFab';
  fab.setAttribute('aria-label', 'অ্যাডমিন মেনু খুলুন');
  fab.setAttribute('aria-haspopup', 'dialog');
  fab.appendChild(icon('fa-bars'));

  const root = el('div', 'sfqn');
  root.hidden = true;
  const overlay = el('div', 'sfqn-ov');
  const sheet = el('section', 'sfqn-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', 'অ্যাডমিন মেনু');

  const hd = el('div', 'sfqn-hd');
  hd.appendChild(el('h2', null, 'অ্যাডমিন মেনু'));
  const closeBtn = el('button', 'sfqn-x');
  closeBtn.type = 'button';
  closeBtn.setAttribute('aria-label', 'বন্ধ করুন');
  closeBtn.appendChild(icon('fa-xmark'));
  hd.appendChild(closeBtn);

  const sr = el('div', 'sfqn-sr');
  sr.appendChild(icon('fa-magnifying-glass'));
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = 'যেকোনো পেজ খুঁজুন';
  input.setAttribute('aria-label', 'পেজ খুঁজুন');
  input.autocomplete = 'off';
  sr.appendChild(input);

  const body = el('div', 'sfqn-bd');

  sheet.append(el('span', 'sfqn-grab'), hd, sr, body);
  root.append(overlay, sheet);
  document.body.append(fab, root);

  // ===== বাটন টেনে সরানো (নিচের নেভ বার/অন্য ভাসমান কিছুর সাথে ঠেকলে) =====
  // টানলে সরে, ছেড়ে দিলে বাঁ/ডান কিনারায় লেগে যায়; জায়গা ডিভাইসে মনে থাকে। শুধু ট্যাপ করলে মেনু খোলে।
  const POS_KEY = 'sf_admin_qn_pos';
  const SIZE = 56;
  const EDGE = 8;
  const DEFAULT_BOTTOM = 96; // নিচের নেভ বারের উপরে
  const clamp01 = (n) => Math.min(1, Math.max(0, n));
  function readPos() {
    try {
      const o = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
      if (o && typeof o.fx === 'number' && typeof o.fy === 'number') return { fx: clamp01(o.fx), fy: clamp01(o.fy) };
    } catch (_) { /* বাদ */ }
    return null;
  }
  function savePos(p) {
    try { localStorage.setItem(POS_KEY, JSON.stringify(p)); } catch (_) { /* বাদ */ }
  }
  function spanX() { return Math.max(1, window.innerWidth - SIZE - 2 * EDGE); }
  function spanY() { return Math.max(1, window.innerHeight - SIZE - 2 * EDGE); }
  function defaultPos() { return { fx: 1, fy: clamp01((window.innerHeight - SIZE - DEFAULT_BOTTOM - EDGE) / spanY()) }; }
  let pos = readPos() || defaultPos();
  function place(p) {
    fab.style.left = (EDGE + p.fx * spanX()) + 'px';
    fab.style.top = (EDGE + p.fy * spanY()) + 'px';
  }
  place(pos);
  window.addEventListener('resize', () => place(pos));

  let drag = null;
  let moved = false;
  fab.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    const r = fab.getBoundingClientRect();
    drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top };
    moved = false;
    try { fab.setPointerCapture(e.pointerId); } catch (_) { /* বাদ */ }
  });
  fab.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.sx;
    const dy = e.clientY - drag.sy;
    if (!moved && Math.hypot(dx, dy) < 6) return;
    moved = true;
    fab.classList.add('is-drag');
    const x = Math.min(window.innerWidth - SIZE - EDGE, Math.max(EDGE, drag.ox + dx));
    const y = Math.min(window.innerHeight - SIZE - EDGE, Math.max(EDGE, drag.oy + dy));
    fab.style.left = x + 'px';
    fab.style.top = y + 'px';
    e.preventDefault();
  });
  function endDrag(e) {
    if (!drag || (e && e.pointerId !== drag.id)) return;
    drag = null;
    fab.classList.remove('is-drag');
    if (!moved) return;
    const r = fab.getBoundingClientRect();
    const cx = r.left + SIZE / 2;
    pos = { fx: cx < window.innerWidth / 2 ? 0 : 1, fy: clamp01((r.top - EDGE) / spanY()) };
    place(pos);
    savePos(pos);
    // টানার শেষে আসা click-এ মেনু খুলবে না
    setTimeout(() => { moved = false; }, 0);
  }
  fab.addEventListener('pointerup', endDrag);
  fab.addEventListener('pointercancel', endDrag);

  function shortcutList() {
    const badges = getBadges();
    const favs = getFavs().filter((h) => byHref[h]);
    const pend = Object.keys(badges).filter((h) => byHref[h] && badges[h] > 0).sort((a, b) => badges[b] - badges[a]);
    const rec = getRecent().filter((h) => byHref[h]);
    const out = [];
    [favs, pend, rec].forEach((list) => list.forEach((h) => { if (out.indexOf(h) === -1) out.push(h); }));
    return out.slice(0, 12);
  }

  function render(q) {
    const badges = getBadges();
    body.replaceChildren();

    if (!q) {
      const sc = shortcutList();
      if (sc.length) {
        const nav = el('nav', 'sfqn-sc');
        nav.setAttribute('aria-label', 'শর্টকাট');
        sc.forEach((h) => {
          const p = byHref[h];
          const a = el('a');
          a.href = p.href;
          a.setAttribute('aria-label', p.name);
          a.appendChild(icon(p.icon));
          if (badges[h] > 0) a.appendChild(badge(badges[h]));
          nav.appendChild(a);
        });
        body.appendChild(nav);
      }
    }

    let total = 0;
    ADMIN_GROUPS.forEach((g) => {
      const list = pages.filter((p) => p.group === g.id && (!q || p.search.indexOf(q) !== -1));
      if (!list.length) return;
      total += list.length;
      body.appendChild(el('h3', 'sfqn-g', g.name));
      const box = el('div', 'sfqn-l');
      list.forEach((p) => {
        const a = el('a', 'sfqn-r');
        a.href = p.href;
        if (p.href === base) a.setAttribute('aria-current', 'page');
        const ic = el('span', 'sfqn-ic');
        ic.appendChild(icon(p.icon));
        a.append(ic, el('span', 'sfqn-n', p.name));
        if (p.href === base) a.appendChild(el('span', 'sfqn-here', 'এখানে আছেন'));
        if (badges[p.href] > 0) a.appendChild(badge(badges[p.href]));
        box.appendChild(a);
      });
      body.appendChild(box);
    });

    if (!total) body.appendChild(el('p', 'sfqn-none', 'কিছু পাওয়া যায়নি'));
  }

  let prevOverflow = '';
  function open() {
    input.value = '';
    render('');
    root.hidden = false;
    prevOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    input.focus();
  }
  function close() {
    root.hidden = true;
    document.documentElement.style.overflow = prevOverflow;
    fab.focus();
  }

  fab.addEventListener('click', () => { if (moved) return; open(); });
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', close);
  input.addEventListener('input', () => render(input.value.trim().toLowerCase()));

  // Esc দিয়ে বন্ধ; Tab শিটের ভেতরেই ঘোরে
  sheet.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    const f = sheet.querySelectorAll('a[href],button,input');
    if (!f.length) return;
    const first = f[0];
    const last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

export function mountAdminQuickNav(detail) {
  try {
    build(detail || {});
  } catch (_) {
    // মেনু ফেইল করলে আসল পেজ যেন না ভাঙে
  }
}
