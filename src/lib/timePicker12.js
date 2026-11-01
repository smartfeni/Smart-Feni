// path: src/lib/timePicker12.js
//
// সব <input type="time"> অটোমেটিক ১২ ঘণ্টার পিকারে বদলে দেয়:
//   [ঘণ্টা ▾] : [মিনিট ▾]
//   [সকাল] [দুপুর] [বিকেল] [রাত]
//
// আসল input থাকে (লুকানো), তার .value সবসময় "HH:MM" (২৪ ঘণ্টা) — তাই
// যেসব কোড input.value পড়ে বা লেখে সেগুলো অপরিবর্তিত কাজ করবে।
// পিকারে বেলা আর ঘণ্টা মেলানোর কোনো চেক নেই (ইউজার যা বাছবে তাই)।
//
// ব্যবহার: BaseLayout-এ initTimePicker12() একবার কল করা হয়।
// কোনো ইনপুটে বাদ দিতে: data-no-t12। ছোট ক্যাপশন দিতে: data-t12-label="শুরু"

const BN = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
const bn = (n) => String(n).replace(/[0-9]/g, (d) => BN[Number(d)]);
const pad = (n) => String(n).padStart(2, '0');

const PERIODS = [
  ['s', 'সকাল'],
  ['d', 'দুপুর'],
  ['b', 'বিকেল'],
  ['r', 'রাত'],
];

// ঘণ্টা (১–১২) + বেলা → ২৪ ঘণ্টা
function to24(h, p) {
  if (p === 's') return h === 12 ? 0 : h;
  if (p === 'r') {
    if (h === 12) return 0; // রাত ১২ = মাঝরাত
    return h <= 5 ? h : h + 12; // রাত ১–৫ = মাঝরাতের পর, ৬–১১ = সন্ধ্যা/রাত
  }
  // দুপুর, বিকেল
  return h === 12 ? 12 : h + 12;
}

// ২৪ ঘণ্টা → ঘণ্টা (১–১২) + বেলা (দেখানোর জন্য)
function from24(H) {
  if (H === 0) return { h: 12, p: 'r' };
  if (H <= 4) return { h: H, p: 'r' };
  if (H < 12) return { h: H, p: 's' };
  if (H === 12) return { h: 12, p: 'd' };
  if (H <= 15) return { h: H - 12, p: 'd' };
  if (H <= 18) return { h: H - 12, p: 'b' };
  return { h: H - 12, p: 'r' };
}

const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');

function injectStyle() {
  if (document.getElementById('sf-t12-style')) return;
  const st = document.createElement('style');
  st.id = 'sf-t12-style';
  st.textContent = `
    .sf-t12 { display: flex; flex-direction: column; gap: 6px; flex: 1 1 176px; min-width: 0; width: 100%; box-sizing: border-box; }
    .sf-t12-cap { font-size: 0.74rem; font-weight: 700; color: #6B7A90; line-height: 1.2; }
    .sf-t12-top { display: flex; align-items: center; gap: 6px; }
    .sf-t12-top b { color: #1B2A4A; font-weight: 800; }
    .sf-t12-top select {
      flex: 1; min-width: 0; height: 44px; padding: 0 6px; box-sizing: border-box;
      border: 1.5px solid #E5EAF0; border-radius: 12px; background: #FBFCFE;
      color: #1B2A4A; font-family: inherit; font-size: 16px; font-weight: 600; text-align: center;
    }
    .sf-t12-top select:focus { outline: none; border-color: #FF6B35; background: #fff; }
    .sf-t12-per { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
    .sf-t12-per button {
      min-height: 38px; padding: 0 1px; border: 1.5px solid #E5EAF0; border-radius: 10px;
      background: #fff; color: #1B2A4A; font-family: inherit; font-size: 0.72rem; font-weight: 700;
      cursor: pointer; white-space: nowrap;
    }
    .sf-t12-per button.on { background: #FF6B35; border-color: #FF6B35; color: #fff; }
    .sf-t12-src {
      position: absolute !important; width: 1px !important; height: 1px !important; opacity: 0 !important;
      pointer-events: none !important; padding: 0 !important; margin: 0 !important; border: 0 !important;
      overflow: hidden !important;
    }
    .sf-t12-disabled { opacity: 0.6; pointer-events: none; }
    body.mod-no-settings #hoursTimedWrap .sf-t12 { opacity: 0.6; pointer-events: none; }
  `;
  document.head.appendChild(st);
}

function enhance(input) {
  if (input._sft12) return;
  input._sft12 = true;

  const state = { p: '' };

  const wrap = document.createElement('div');
  wrap.className = 'sf-t12';
  wrap.setAttribute('role', 'group');
  const caption = input.getAttribute('data-t12-label') || '';
  wrap.setAttribute('aria-label', input.getAttribute('aria-label') || caption || 'সময়');
  if (input.disabled || input.readOnly) wrap.classList.add('sf-t12-disabled');

  if (caption) {
    const cap = document.createElement('div');
    cap.className = 'sf-t12-cap';
    cap.textContent = caption;
    wrap.appendChild(cap);
  }

  const top = document.createElement('div');
  top.className = 'sf-t12-top';

  const hSel = document.createElement('select');
  hSel.setAttribute('aria-label', 'ঘণ্টা');
  hSel.appendChild(new Option('ঘণ্টা', ''));
  for (let h = 1; h <= 12; h++) hSel.appendChild(new Option(bn(h), String(h)));

  const mSel = document.createElement('select');
  mSel.setAttribute('aria-label', 'মিনিট');
  mSel.appendChild(new Option('মিনিট', ''));
  for (let m = 0; m < 60; m += 5) mSel.appendChild(new Option(bn(pad(m)), String(m)));

  const colon = document.createElement('b');
  colon.textContent = ':';

  top.appendChild(hSel);
  top.appendChild(colon);
  top.appendChild(mSel);
  wrap.appendChild(top);

  const per = document.createElement('div');
  per.className = 'sf-t12-per';
  const chips = {};
  PERIODS.forEach(([key, label]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', () => {
      state.p = key;
      paintChips();
      commit();
    });
    chips[key] = b;
    per.appendChild(b);
  });
  wrap.appendChild(per);

  function paintChips() {
    Object.keys(chips).forEach((k) => {
      const on = state.p === k;
      chips[k].classList.toggle('on', on);
      chips[k].setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  function ensureMinuteOption(m) {
    const v = String(m);
    if ([...mSel.options].some((o) => o.value === v)) return;
    const opt = new Option(bn(pad(m)), v);
    const after = [...mSel.options].find((o) => o.value !== '' && Number(o.value) > m);
    mSel.insertBefore(opt, after || null);
  }

  // আসল ভ্যালু (HH:MM) থেকে UI আঁকা
  function render() {
    const mt = /^(\d{1,2}):(\d{2})/.exec(nativeValue.get.call(input) || '');
    if (!mt) {
      hSel.value = '';
      mSel.value = '';
      state.p = '';
    } else {
      const f = from24(Number(mt[1]));
      const M = Number(mt[2]);
      ensureMinuteOption(M);
      hSel.value = String(f.h);
      mSel.value = String(M);
      state.p = f.p;
    }
    paintChips();
  }

  // UI থেকে আসল ভ্যালু (HH:MM) বানানো
  function commit() {
    if ((hSel.value !== '' || state.p) && mSel.value === '') mSel.value = '0';
    let v = '';
    if (hSel.value !== '' && state.p) {
      v = pad(to24(Number(hSel.value), state.p)) + ':' + pad(Number(mSel.value || 0));
    }
    nativeValue.set.call(input, v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  hSel.addEventListener('change', commit);
  mSel.addEventListener('change', commit);

  // অন্য কোড input.value = '...' লিখলে UI-ও মিলিয়ে নেবে
  Object.defineProperty(input, 'value', {
    configurable: true,
    enumerable: true,
    get() { return nativeValue.get.call(input); },
    set(v) { nativeValue.set.call(input, v); render(); },
  });

  input.classList.add('sf-t12-src');
  input.tabIndex = -1;
  input.setAttribute('aria-hidden', 'true');
  input.after(wrap);
  render();
}

function scan(root) {
  if (!root || root.nodeType !== 1) return;
  if (root.matches && root.matches('input[type="time"]:not([data-no-t12])')) enhance(root);
  if (root.querySelectorAll) root.querySelectorAll('input[type="time"]:not([data-no-t12])').forEach(enhance);
}

export function initTimePicker12() {
  if (window.__sfT12Init) return;
  window.__sfT12Init = true;
  injectStyle();
  scan(document.body);
  new MutationObserver((muts) => {
    for (const m of muts) m.addedNodes.forEach(scan);
  }).observe(document.documentElement, { childList: true, subtree: true });
}
