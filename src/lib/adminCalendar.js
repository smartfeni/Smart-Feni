// path: src/lib/adminCalendar.js
// ============================================================
// অ্যাডমিন পেজের জন্য ১ মাসের ক্যালেন্ডার (এক দিন বা দুই তারিখ ট্যাপে রেঞ্জ)।
// ব্যবহার: admin/delivery-orders.astro (সম্পন্ন ট্যাব), admin/manual-orders.astro (ক্যালেন্ডার চিপ)।
// সব তারিখ বাংলাদেশ টাইমে (Asia/Dhaka, UTC+6, DST নেই): কী = 'YYYY-MM-DD'।
// স্টাইল JS থেকেই একবার ইনজেক্ট হয় (Astro scoped CSS সমস্যা এড়াতে), ক্লাস sfcal-।
// ইউজারের কোনো টেক্সট এখানে আসে না, সব textContent দিয়ে বসানো।
// ============================================================

const BD_MS = 6 * 3600000;
const MONTHS = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
const MONTHS_SHORT = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টে', 'অক্টো', 'নভে', 'ডিসে'];
const WEEK = ['র', 'সো', 'ম', 'বু', 'বৃ', 'শু', 'শ'];

const bn = (v) => String(v).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
const pad = (n) => String(n).padStart(2, '0');
const keyOf = (y, m, d) => y + '-' + pad(m) + '-' + pad(d);

// Date -> বাংলাদেশ তারিখের কী
export function dayKeyOf(date) {
  const x = new Date(date.getTime() + BD_MS);
  return keyOf(x.getUTCFullYear(), x.getUTCMonth() + 1, x.getUTCDate());
}

export function todayKey() {
  return dayKeyOf(new Date());
}

export function addDaysKey(key, n) {
  const p = key.split('-').map(Number);
  const t = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return keyOf(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// fromKey..toKey (দুটোই অন্তর্ভুক্ত) -> ISO রেঞ্জ [from, to) বাংলাদেশ মধ্যরাত ধরে
export function dhakaRangeIso(fromKey, toKey) {
  return {
    fromIso: new Date(fromKey + 'T00:00:00+06:00').toISOString(),
    toIso: new Date(addDaysKey(toKey, 1) + 'T00:00:00+06:00').toISOString(),
  };
}

// m = ১..১২
export function monthRangeIso(y, m) {
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return {
    fromIso: new Date(keyOf(y, m, 1) + 'T00:00:00+06:00').toISOString(),
    toIso: new Date(keyOf(ny, nm, 1) + 'T00:00:00+06:00').toISOString(),
  };
}

export function monthLabel(y, m) {
  return MONTHS[m - 1] + ' ' + bn(y);
}

// '2026-11-02' -> '২ নভে'
export function labelKey(key) {
  const p = key.split('-').map(Number);
  return bn(p[2]) + ' ' + MONTHS_SHORT[p[1] - 1];
}

const CSS = [
  '.sfcal{background:#fff;border-radius:20px;box-shadow:0 2px 12px rgba(27,42,74,.08);padding:12px;font-family:"Hind Siliguri",system-ui,sans-serif;color:#1B2A4A;margin-bottom:12px;box-sizing:border-box}',
  '.sfcal *{box-sizing:border-box}',
  '.sfcal-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}',
  '.sfcal-t{font-size:16px;font-weight:700}',
  '.sfcal-nav{width:44px;height:44px;border:0;border-radius:14px;background:#F1F5F9;color:#1B2A4A;font-size:22px;line-height:1;cursor:pointer;padding:0}',
  '.sfcal-nav:disabled{opacity:.35;cursor:not-allowed}',
  '.sfcal-w,.sfcal-g{display:grid;grid-template-columns:repeat(7,1fr);gap:2px}',
  '.sfcal-w span{text-align:center;font-size:12.5px;font-weight:600;color:#8FA0BC;padding:4px 0}',
  '.sfcal-d{height:48px;border:0;border-radius:12px;background:transparent;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;cursor:pointer;color:#1B2A4A;padding:0;font-family:inherit}',
  '.sfcal-d b{font-size:15px;font-weight:600;line-height:1.1}',
  '.sfcal-d i{font-style:normal;font-size:11px;font-weight:700;color:#FF6B35;min-height:13px;line-height:13px}',
  '.sfcal-d.today b{color:#FF6B35}',
  '.sfcal-d.in{background:#FFF0E8;border-radius:0}',
  '.sfcal-d.s,.sfcal-d.e{background:#1B2A4A;color:#fff;border-radius:12px}',
  '.sfcal-d.s b,.sfcal-d.e b{color:#fff}',
  '.sfcal-d.s i,.sfcal-d.e i{color:#FFB899}',
  '.sfcal-d:disabled{opacity:.3;cursor:not-allowed}',
  '.sfcal-f{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:8px;font-size:13px;font-weight:600;color:#5B6B86}',
  '.sfcal-clr{min-height:44px;padding:0 12px;border:0;background:none;color:#1B2A4A;font-size:13px;font-weight:700;text-decoration:underline;cursor:pointer;font-family:inherit}',
].join('');

function injectStyle() {
  if (document.getElementById('sfcal-style')) return;
  const s = document.createElement('style');
  s.id = 'sfcal-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function mk(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function mkBtn(cls, text, label) {
  const b = mk('button', cls, text);
  b.type = 'button';
  b.setAttribute('aria-label', label);
  return b;
}

// opts: { allowFuture?: boolean, onRangeChange(from, to), onMonthChange(y, m) }
// রেঞ্জ: প্রথম ট্যাপ = এক দিন, দ্বিতীয় ট্যাপ = রেঞ্জ (from..to), তৃতীয় ট্যাপ = নতুন করে শুরু
export function createRangeCalendar(root, opts) {
  const o = opts || {};
  injectStyle();
  const t = todayKey().split('-').map(Number);
  const st = { y: t[0], m: t[1], from: '', to: '', awaiting: false, counts: {} };

  root.textContent = '';
  root.classList.add('sfcal');

  const head = mk('div', 'sfcal-h');
  const prev = mkBtn('sfcal-nav', '‹', 'আগের মাস');
  const title = mk('div', 'sfcal-t');
  const next = mkBtn('sfcal-nav', '›', 'পরের মাস');
  head.appendChild(prev);
  head.appendChild(title);
  head.appendChild(next);

  const week = mk('div', 'sfcal-w');
  WEEK.forEach((w) => week.appendChild(mk('span', '', w)));

  const grid = mk('div', 'sfcal-g');

  const foot = mk('div', 'sfcal-f');
  const hint = mk('span', '');
  const clr = mkBtn('sfcal-clr', 'মুছুন', 'তারিখ বাছাই মুছুন');
  foot.appendChild(hint);
  foot.appendChild(clr);

  root.appendChild(head);
  root.appendChild(week);
  root.appendChild(grid);
  root.appendChild(foot);

  function fire() {
    if (o.onRangeChange) o.onRangeChange(st.from, st.to);
  }

  function pick(key) {
    if (!st.awaiting) {
      st.from = key;
      st.to = key;
      st.awaiting = true;
    } else {
      st.awaiting = false;
      if (key < st.from) {
        st.to = st.from;
        st.from = key;
      } else {
        st.to = key;
      }
    }
    render();
    fire();
  }

  function render() {
    title.textContent = monthLabel(st.y, st.m);
    next.disabled = !o.allowFuture && st.y * 12 + st.m >= t[0] * 12 + t[1];
    grid.textContent = '';
    const first = new Date(Date.UTC(st.y, st.m - 1, 1)).getUTCDay();
    const days = new Date(Date.UTC(st.y, st.m, 0)).getUTCDate();
    const today = todayKey();
    for (let i = 0; i < first; i += 1) grid.appendChild(mk('div', ''));
    for (let d = 1; d <= days; d += 1) {
      const key = keyOf(st.y, st.m, d);
      const n = st.counts[key] || 0;
      let cls = 'sfcal-d';
      if (key === today) cls += ' today';
      if (st.from && key >= st.from && key <= st.to) cls += ' in';
      if (key === st.from) cls += ' s';
      if (key === st.to) cls += ' e';
      const b = mk('button', cls);
      b.type = 'button';
      b.disabled = !o.allowFuture && key > today;
      b.setAttribute('aria-label', bn(d) + ' ' + MONTHS[st.m - 1] + (n ? ', ' + bn(n) + 'টি অর্ডার' : ''));
      b.appendChild(mk('b', '', bn(d)));
      b.appendChild(mk('i', '', n ? bn(n) : ''));
      b.addEventListener('click', () => pick(key));
      grid.appendChild(b);
    }
    if (st.from && st.awaiting) hint.textContent = labelKey(st.from) + ' · শেষ তারিখ ট্যাপ করুন';
    else if (st.from) hint.textContent = st.from === st.to ? labelKey(st.from) : labelKey(st.from) + ' – ' + labelKey(st.to);
    else hint.textContent = 'তারিখে ট্যাপ করুন। দুটো তারিখ ট্যাপ করলে রেঞ্জ।';
    clr.style.display = st.from ? '' : 'none';
  }

  function shiftMonth(delta) {
    let m = st.m + delta;
    let y = st.y;
    if (m < 1) { m = 12; y -= 1; }
    if (m > 12) { m = 1; y += 1; }
    st.m = m;
    st.y = y;
    render();
    if (o.onMonthChange) o.onMonthChange(st.y, st.m);
  }

  prev.addEventListener('click', () => shiftMonth(-1));
  next.addEventListener('click', () => shiftMonth(1));
  clr.addEventListener('click', () => {
    st.from = '';
    st.to = '';
    st.awaiting = false;
    render();
    fire();
  });

  render();

  return {
    setCounts(map) {
      st.counts = map || {};
      render();
    },
    getRange() {
      return { from: st.from, to: st.to };
    },
    getMonth() {
      return { y: st.y, m: st.m };
    },
    clear(silent) {
      st.from = '';
      st.to = '';
      st.awaiting = false;
      render();
      if (!silent) fire();
    },
  };
}
