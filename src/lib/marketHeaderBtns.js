// ============================================================
// কুইক ডেলিভারির হেডারে সবসময় দেখানো দুটো বাটন: 🛒 কার্ট ও 🧾 আমার অর্ডার
// - কার্ট ব্যাজ: কার্টের আইটেম সংখ্যা (marketCart), চাপলে চেকআউট (খালি হলে বার্তা)
// - অর্ডার ব্যাজ: চলমান কুইক অর্ডার + চলমান প্রি-অর্ডার, চাপলে /my-orders
// ব্যবহার: mountMarketActions(parentEl, { tone: 'light' | 'glass' })
// সব টেক্সট textContent দিয়ে; স্টাইল ইনলাইন + একবার <style> যোগ (JS-injected, scoped CSS কাজ করে না)।
// ============================================================
import { supabase } from './supabase.js';
import { getCart } from './marketCart.js';

const BN = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

function ensureStyle() {
  if (document.getElementById('qmaStyle')) return;
  const st = document.createElement('style');
  st.id = 'qmaStyle';
  st.textContent = [
    '.qma{display:flex;gap:8px;flex:none}',
    '.qma-b{position:relative;width:44px;height:44px;border-radius:22px;border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;text-decoration:none}',
    '.qma.light .qma-b{background:#fff;box-shadow:0 4px 14px rgba(27,42,74,.12)}',
    '.qma.glass .qma-b{background:rgba(255,255,255,.95);box-shadow:0 2px 10px rgba(0,0,0,.18)}',
    '.qma-b svg{width:22px;height:22px;fill:none;stroke:#1B2A4A;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round}',
    '.qma-n{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#FF6B35;color:#fff;font:700 11.5px/20px "Hind Siliguri",system-ui,sans-serif;text-align:center;box-shadow:0 0 0 2px #fff}',
    '.qma-n.ord{background:#1B2A4A}',
    '.qma-n[hidden]{display:none}',
    '.qma-b:focus-visible{outline:3px solid #FF6B35;outline-offset:2px}',
  ].join('');
  document.head.appendChild(st);
}

function btn(tag, label, paths) {
  const b = document.createElement(tag);
  b.className = 'qma-b';
  if (tag === 'button') b.type = 'button';
  b.setAttribute('aria-label', label);
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  paths.forEach((d) => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); s.appendChild(p); });
  b.appendChild(s);
  const n = document.createElement('span');
  n.className = 'qma-n';
  n.hidden = true;
  b.appendChild(n);
  return { b, n };
}

async function activeOrderCount() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return 0;
  const uid = session.user.id;
  const [a, b] = await Promise.all([
    supabase.from('delivery_requests').select('id', { count: 'exact', head: true })
      .eq('customer_profile_id', uid).eq('is_market', true).in('status', ['open', 'confirmed', 'delivered']),
    supabase.from('market_preorders').select('id', { count: 'exact', head: true })
      .eq('customer_profile_id', uid).in('status', ['pending', 'confirmed', 'dispatched']),
  ]);
  return (a.count || 0) + (b.count || 0);
}

export function mountMarketActions(parent, opts = {}) {
  if (!parent) return null;
  ensureStyle();
  const wrap = document.createElement('div');
  wrap.className = 'qma ' + (opts.tone || 'light');
  const cart = btn('button', 'কার্ট', ['M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2', 'M9.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z', 'M17.5 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z']);
  const ord = btn('a', 'আমার অর্ডার', ['M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2Z', 'M9 8h6', 'M9 12h6']);
  ord.b.href = '/my-orders';
  ord.n.classList.add('ord');
  wrap.appendChild(cart.b);
  wrap.appendChild(ord.b);
  parent.appendChild(wrap);

  function paintCart() {
    const c = getCart();
    const n = (c.lines || []).reduce((a, l) => a + Number(l.qty || 0), 0);
    cart.n.hidden = !n;
    cart.n.textContent = BN(n > 99 ? '99+' : n);
    cart.b.setAttribute('aria-label', n ? 'কার্ট, ' + BN(n) + 'টি আইটেম' : 'কার্ট (খালি)');
  }
  async function paintOrders() {
    try {
      const n = await activeOrderCount();
      ord.n.hidden = !n;
      ord.n.textContent = BN(n);
      ord.b.setAttribute('aria-label', n ? 'আমার অর্ডার, ' + BN(n) + 'টি চলমান' : 'আমার অর্ডার');
    } catch (_) { /* ব্যাজ না এলেও বাটন কাজ করবে */ }
  }
  cart.b.addEventListener('click', () => {
    const c = getCart();
    if (!(c.lines || []).length) { if (window.showToast) window.showToast('কার্ট খালি — দোকান থেকে আইটেম যোগ করুন', 'info'); return; }
    location.href = '/market/checkout';
  });
  window.addEventListener('smartfeni:market-cart-changed', paintCart);
  window.addEventListener('pageshow', () => { paintCart(); paintOrders(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) paintOrders(); });
  paintCart();
  paintOrders();
  return { paintCart, paintOrders };
}
