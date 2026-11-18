// path: src/lib/marketOrderSheet.js
// ============================================================
// কুইক ডেলিভারি অর্ডারের অগ্রিম/দাম/অবস্থা প্যানেল অর্ডার কার্ডের ওপরেই (পেজ বদলানো ছাড়া) খোলে:
// পুরো-স্ক্রিন শিটে /market/order?id=...&embed=1 (শুধু প্যানেল, হেডার/ব্যাক লুকানো)।
// ব্যবহার: bindMarketOrderSheet(containerEl, onClose) — container-এর ভেতরের a[data-mk-order] ক্লিকে শিট খোলে।
// ============================================================
let sheet = null;

export function openMarketOrderSheet(id, onClose) {
  closeSheet();
  const wrap = document.createElement('div');
  wrap.id = 'mkOrderSheet';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.setAttribute('aria-label', 'কুইক ডেলিভারি অর্ডার');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9000;background:#FFF4EC;display:flex;flex-direction:column;';
  const bar = document.createElement('div');
  bar.style.cssText = 'flex:none;display:flex;align-items:center;gap:10px;padding:10px 14px;background:#1B2A4A;color:#fff;font-weight:700;font-family:inherit;';
  const close = document.createElement('button');
  close.type = 'button';
  close.setAttribute('aria-label', 'বন্ধ করুন');
  close.textContent = '✕';
  close.style.cssText = 'width:38px;height:38px;border:0;border-radius:50%;background:rgba(255,255,255,.18);color:#fff;font-size:18px;cursor:pointer;';
  const title = document.createElement('span');
  title.textContent = 'কুইক ডেলিভারি অর্ডার';
  bar.appendChild(close);
  bar.appendChild(title);
  const frame = document.createElement('iframe');
  frame.src = '/market/order?embed=1&id=' + encodeURIComponent(id);
  frame.title = 'কুইক ডেলিভারি অর্ডার';
  frame.style.cssText = 'flex:1;width:100%;border:0;background:#FFF4EC;';
  wrap.appendChild(bar);
  wrap.appendChild(frame);
  document.body.appendChild(wrap);
  document.body.style.overflow = 'hidden';
  sheet = { wrap, onClose };
  close.addEventListener('click', closeSheet);
  close.focus();
}

export function closeSheet() {
  if (!sheet) return;
  const { wrap, onClose } = sheet;
  sheet = null;
  wrap.remove();
  document.body.style.overflow = '';
  try { if (onClose) onClose(); } catch (e) {}
}

export function bindMarketOrderSheet(root, onClose) {
  root.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('a[data-mk-order]');
    if (!a) return;
    e.preventDefault();
    openMarketOrderSheet(a.getAttribute('data-mk-order'), onClose);
  });
}
