// path: src/lib/riderWallet.js
// ============================================================
// রাইডার ওয়ালেট (রাইডারের দিক) — delivery-hero ও Pro হিরো দুই জায়গায় একই কোড।
// নিয়ম (SF, ২৬ নভে ২০২৬): ব্যালেন্স = rider_wallet_entries-এর যোগফল
//   − = কোম্পানিকে দেবেন, + = কোম্পানি দেবে। লাইন শুধু ডাটাবেস লেখে।
// ১) mountWalletCard(): কুইক ডেলিভারি পেজে আগের "বিকাশ নম্বর" কার্ডের জায়গায় ওয়ালেট কার্ড
//    (ব্যালেন্স + বিকাশ নম্বরের অবস্থা + "ওয়ালেট খুলুন")। id heroBkashCard রাখা, যাতে পুরনো scroll কাজ করে।
// ২) mountWalletPage(): ওয়ালেট পেজ — ব্যালেন্স, টাকা জমা / টাকা তুলুন / অগ্রিম চান, বিকাশ নম্বর
//    যোগ/বদল (RPC rider_set_bkash), অপেক্ষায় থাকা অনুরোধ, লেনদেন।
// RPC: rider_wallet_me, rider_wallet_request(p_kind, p_amount, p_request_id, p_method, p_number, p_trx_id, p_note)
// URL প্যারামিটার: ?advance=<order id> (অগ্রিমের ফর্ম ওই অর্ডারসহ খোলে), ?bkash=1 (নম্বরের ফর্ম খোলে)
// ইউজারের লেখা সব textContent দিয়ে বসানো।
// ============================================================

const BN = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const tk = (n) => '৳' + BN(Math.abs(Math.round(Number(n) || 0)));
const toast = (t, type = 'success') => window.showToast?.(t, type);

export function walletHref(extra) {
  const pro = typeof location !== 'undefined' && location.pathname.indexOf('/pro') === 0;
  return (pro ? '/pro/hero/wallet' : '/delivery-hero/wallet') + (extra ? '?' + extra : '');
}
export function heroHomeHref() {
  const pro = typeof location !== 'undefined' && location.pathname.indexOf('/pro') === 0;
  return pro ? '/pro/hero/delivery' : '/delivery-hero';
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function balText(b) {
  const v = Number(b) || 0;
  if (v < 0) return { label: 'কোম্পানিকে দেবেন', cls: 'neg' };
  if (v > 0) return { label: 'আপনি পাবেন', cls: 'pos' };
  return { label: 'হিসাব সমান', cls: 'zero' };
}

let cssDone = false;
function injectCss() {
  if (cssDone) return;
  cssDone = true;
  const s = document.createElement('style');
  s.textContent = [
    '#heroBkashCard.rw-card{margin:12px 0;padding:14px;border-radius:18px;background:#fff;border:1.5px solid #E5EAF0;font-family:inherit;color:#1B2A4A;display:flex;flex-direction:column;gap:10px;text-decoration:none}',
    '.rw-card-top{display:flex;align-items:center;gap:12px}',
    '.rw-card-ic{width:42px;height:42px;border-radius:14px;background:#FFF1E8;color:#E2531F;display:flex;align-items:center;justify-content:center;font-size:18px;flex:none}',
    '.rw-card-t{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}',
    '.rw-card-t small{font-size:12.5px;font-weight:700;color:#5A6B85}',
    '.rw-card-t b{font-size:20px;font-weight:800}',
    '.rw-card-t b.neg{color:#B42318}.rw-card-t b.pos{color:#14804A}',
    '.rw-card-go{min-height:40px;padding:0 14px;border-radius:12px;background:#1B2A4A;color:#fff;font-weight:800;display:inline-flex;align-items:center;text-decoration:none;font-size:14px;white-space:nowrap}',
    '.rw-card-bk{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#5A6B85}',
    '.rw-card-bk img{width:22px;height:22px;object-fit:contain}',
    '.rw-card-warn{background:#FFF1F7;border:1.5px solid #E2136E;border-radius:12px;padding:10px 12px;color:#9E0F4D;font-size:13.5px;font-weight:700;display:flex;align-items:center;gap:8px;text-decoration:none}',
    '.rw-card-warn span{flex:1}',
    '.rw-card-warn b{background:#E2136E;color:#fff;border-radius:10px;padding:6px 10px;font-size:13px;white-space:nowrap}',
  ].join('');
  document.head.appendChild(s);
}

// ---------- ১) কুইক ডেলিভারি পেজের কার্ড ----------
export async function mountWalletCard(supabase, riderId, anchorEl) {
  if (!riderId || !anchorEl || !anchorEl.parentNode) return;
  injectCss();
  let box = document.getElementById('heroBkashCard');
  if (!box) {
    box = el('a', 'rw-card');
    box.id = 'heroBkashCard';
    anchorEl.parentNode.insertBefore(box, anchorEl);
  }
  let me = null;
  try { const { data } = await supabase.rpc('rider_wallet_me'); me = data; } catch (_) { /* নিচে ফাঁকা ধরে */ }
  let num = (me && me.my_number) || '';
  if (!me) {
    try {
      const { data } = await supabase.from('rider_bkash').select('bkash_number').eq('rider_id', riderId).maybeSingle();
      num = (data && data.bkash_number) || '';
    } catch (_) { /* উপেক্ষা */ }
  }
  window.SF_HERO_BKASH = num;
  box.className = 'rw-card';
  box.href = walletHref();
  box.setAttribute('aria-label', 'আমার ওয়ালেট');
  box.textContent = '';
  const top = el('div', 'rw-card-top');
  const ic = el('span', 'rw-card-ic');
  ic.innerHTML = '<i class="fas fa-wallet" aria-hidden="true"></i>';
  const t = el('div', 'rw-card-t');
  const bal = me && me.ok ? Number(me.balance) || 0 : 0;
  const bt = balText(bal);
  t.append(el('small', null, 'আমার ওয়ালেট · ' + bt.label), el('b', bt.cls, tk(bal)));
  top.append(ic, t, el('span', 'rw-card-go', 'খুলুন'));
  box.appendChild(top);
  if (num) {
    const bk = el('div', 'rw-card-bk');
    const im = el('img');
    im.src = '/market/pay/bkash.webp'; im.alt = ''; im.setAttribute('aria-hidden', 'true');
    bk.append(im, el('span', null, 'বিকাশ নম্বর: ' + BN(num)));
    box.appendChild(bk);
  } else {
    const w = el('div', 'rw-card-warn');
    w.append(el('span', null, 'বিকাশ নম্বর দেওয়া নেই। নম্বর না দিলে কুইক ডেলিভারির অর্ডার নিতে পারবেন না।'), el('b', null, 'নম্বর দিন'));
    box.appendChild(w);
    box.href = walletHref('bkash=1');
  }
}

// ---------- ২) ওয়ালেট পেজ ----------
const KIND = { advance: 'অগ্রিম', deposit: 'জমা', withdraw: 'তোলা' };
const ENTRY = {
  order_cash: 'কাস্টমারের হাতে নেওয়া নগদ', order_advance: 'আপনার বিকাশে আসা অগ্রিম', order_purchase: 'দোকানে দিয়েছেন',
  order_earning: 'ডেলিভারি চার্জ (আপনার আয়)', company_advance: 'কোম্পানি অগ্রিম পাঠিয়েছে', deposit: 'আপনি জমা দিয়েছেন',
  withdraw: 'আপনি তুলেছেন', adjust: 'সংশোধন',
};
const METHOD = { bkash: 'বিকাশ', nagad: 'নগদ', cash: 'হাতে নগদ' };

function dayText(d) {
  return new Date(d).toLocaleString('bn-BD', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Dhaka' });
}

export async function mountWalletPage(supabase, root) {
  const params = new URLSearchParams(location.search);
  const st = { me: null, entries: [], reqs: [], orders: [], showAll: false };

  function sheet(title, build, submitText, onSubmit) {
    const wrap = el('div', 'rw-sheet');
    const form = el('form', 'rw-box');
    form.noValidate = true;
    form.setAttribute('role', 'dialog');
    form.setAttribute('aria-modal', 'true');
    form.setAttribute('aria-label', title);
    const h = el('div', 'rw-box-h');
    const x = el('button', 'rw-x', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'বন্ধ করুন');
    h.append(el('h2', null, title), x);
    form.appendChild(h);
    const body = el('div', 'rw-box-b');
    form.appendChild(body);
    build(body);
    const err = el('p', 'rw-err');
    err.hidden = true;
    form.appendChild(err);
    const go = el('button', 'rw-submit', submitText);
    go.type = 'submit';
    form.appendChild(go);
    wrap.appendChild(form);
    document.body.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const close = () => { wrap.remove(); document.body.style.overflow = ''; };
    x.addEventListener('click', close);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (go.disabled) return;
      if (window.SFValidateForm && !window.SFValidateForm(form)) return;
      err.hidden = true;
      go.disabled = true;
      const old = go.textContent;
      go.textContent = 'পাঠানো হচ্ছে…';
      let msg = null;
      try { msg = await onSubmit(body); } catch (ex) { msg = 'ইন্টারনেটে সমস্যা, আবার চেষ্টা করুন'; }
      go.disabled = false;
      go.textContent = old;
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      close();
    });
    const first = body.querySelector('input, select');
    if (first) setTimeout(() => first.focus(), 80);
  }

  function field(parent, label, input, required, hint) {
    const id = 'rw-' + Math.random().toString(36).slice(2, 8);
    input.id = id;
    const w = el('div', 'rw-field');
    const l = el('label', null, label);
    l.htmlFor = id;
    if (required) { l.appendChild(el('span', 'required-mark', '*')); input.required = true; }
    w.append(l, input);
    if (hint) w.appendChild(el('small', null, hint));
    if (required) {
      const e = el('div', 'field-error-msg');
      e.dataset.errorFor = id;
      e.appendChild(el('span', null, label + ' দিন'));
      w.appendChild(e);
    }
    parent.appendChild(w);
    return input;
  }
  function inp(type, attrs) { const i = el('input', 'rw-in'); i.type = type; Object.assign(i, attrs || {}); return i; }
  function methodPick(parent, withCash) {
    const w = el('div', 'rw-seg');
    w.setAttribute('role', 'radiogroup');
    w.setAttribute('aria-label', 'মাধ্যম');
    const opts = [['bkash', 'বিকাশ'], ['nagad', 'নগদ']].concat(withCash ? [['cash', 'হাতে নগদ']] : []);
    let cur = 'bkash';
    const btns = opts.map(([k, l]) => {
      const b = el('button', null, l);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(k === cur));
      b.addEventListener('click', () => { cur = k; btns.forEach((x, i) => x.setAttribute('aria-checked', String(opts[i][0] === cur))); w.dispatchEvent(new Event('change')); });
      w.appendChild(b);
      return b;
    });
    parent.appendChild(w);
    return { el: w, get: () => cur };
  }
  async function send(kind, amount, extra) {
    const { error } = await supabase.rpc('rider_wallet_request', Object.assign({ p_kind: kind, p_amount: amount }, extra));
    if (error) return /[ঀ-৿]/.test(error.message || '') ? error.message : 'পাঠানো যায়নি, আবার চেষ্টা করুন';
    toast(kind === 'deposit' ? 'জমার তথ্য পাঠানো হয়েছে, ম্যানেজার মিলিয়ে নেবেন' : kind === 'withdraw' ? 'তোলার অনুরোধ পাঠানো হয়েছে' : 'অগ্রিমের অনুরোধ পাঠানো হয়েছে');
    load();
    return null;
  }

  function openDeposit() {
    const bal = Number(st.me.balance) || 0;
    sheet('টাকা জমা দিন', (b) => {
      const info = el('div', 'rw-office');
      info.appendChild(el('p', null, 'নিচের অফিস নম্বরে Send Money করুন, তারপর TrxID দিন। ম্যানেজার মিলিয়ে নিলে ওয়ালেটে যোগ হবে।'));
      [['বিকাশ', st.me.office_bkash], ['নগদ', st.me.office_nagad]].forEach(([n, v]) => {
        if (!v) return;
        const r = el('div', 'rw-office-row');
        r.append(el('span', null, n), el('b', null, BN(v)));
        const c = el('button', 'rw-copy', 'কপি');
        c.type = 'button';
        c.addEventListener('click', async () => { try { await navigator.clipboard.writeText(v); toast('নম্বর কপি হয়েছে'); } catch (_) { toast('কপি হয়নি, হাতে লিখে নিন', 'warning'); } });
        r.appendChild(c);
        info.appendChild(r);
      });
      b.appendChild(info);
      const amt = field(b, 'কত টাকা', inp('number', { min: 1, step: 1, inputMode: 'numeric', name: 'amount', value: bal < 0 ? String(Math.round(-bal)) : '' }), true);
      void amt;
      const m = methodPick(b, true);
      const trx = field(b, 'TrxID', inp('text', { maxLength: 40, name: 'trx', placeholder: 'যেমন 9K2B7XQ1ZP', autocapitalize: 'characters' }), true, 'বিকাশ/নগদের মেসেজে থাকে');
      const trxWrap = trx.parentNode;
      m.el.addEventListener('change', () => { const cash = m.get() === 'cash'; trxWrap.hidden = cash; trx.required = !cash; });
      b._m = m;
    }, 'জমার তথ্য পাঠান', async (b) => {
      const amount = Number(b.querySelector('[name="amount"]').value);
      if (!amount || amount <= 0) return 'টাকার পরিমাণ দিন';
      const method = b._m.get();
      const trx = b.querySelector('[name="trx"]').value.trim();
      if (method !== 'cash' && !trx) return 'TrxID দিন';
      return send('deposit', amount, { p_method: method, p_trx_id: method === 'cash' ? null : trx });
    });
  }

  function openWithdraw() {
    const bal = Number(st.me.balance) || 0;
    if (bal <= 0) { toast('তোলার মতো ব্যালেন্স নেই', 'warning'); return; }
    sheet('টাকা তুলুন', (b) => {
      b.appendChild(el('p', 'rw-p', 'আপনি পাবেন ' + tk(bal) + '। ম্যানেজার টাকা পাঠালে ওয়ালেট থেকে কাটা যাবে।'));
      field(b, 'কত টাকা', inp('number', { min: 1, max: Math.floor(bal), step: 1, inputMode: 'numeric', name: 'amount', value: String(Math.floor(bal)) }), true);
      const m = methodPick(b, false);
      field(b, 'কোন নম্বরে নেবেন', inp('tel', { maxLength: 14, inputMode: 'numeric', name: 'number', value: st.me.my_number || '', placeholder: '01XXXXXXXXX' }), true);
      b._m = m;
    }, 'অনুরোধ পাঠান', async (b) => {
      const amount = Number(b.querySelector('[name="amount"]').value);
      if (!amount || amount <= 0) return 'টাকার পরিমাণ দিন';
      if (amount > bal) return 'ব্যালেন্সের চেয়ে বেশি তোলা যায় না';
      return send('withdraw', amount, { p_method: b._m.get(), p_number: b.querySelector('[name="number"]').value.trim() });
    });
  }

  function openAdvance(preId) {
    if (!st.orders.length) { toast('এখন আপনার কোনো চলমান অর্ডার নেই। অর্ডার নেওয়ার পর অগ্রিম চাইতে পারবেন।', 'warning'); return; }
    sheet('অগ্রিম চান', (b) => {
      b.appendChild(el('p', 'rw-p', 'অর্ডারের জিনিস কিনতে টাকা লাগলে চান। ম্যানেজার টাকা পাঠালে ওয়ালেটে কোম্পানির পাওনা হিসেবে লেখা হবে, কাস্টমার থেকে টাকা নিয়ে জমা দেবেন।'));
      const sel = el('select', 'rw-in');
      sel.name = 'order';
      st.orders.forEach((o) => {
        const op = el('option', null, (o.order_no || 'অর্ডার') + (o.need ? ' · জিনিসের দাম ' + tk(o.need) : ''));
        op.value = o.id;
        sel.appendChild(op);
      });
      if (preId && st.orders.some((o) => o.id === preId)) sel.value = preId;
      field(b, 'কোন অর্ডার', sel, true);
      const amt = field(b, 'কত টাকা', inp('number', { min: 1, step: 1, inputMode: 'numeric', name: 'amount' }), true);
      const fillAmt = () => { const o = st.orders.find((x) => x.id === sel.value); if (o && o.need && !amt.dataset.touched) amt.value = String(Math.round(o.need)); };
      amt.addEventListener('input', () => { amt.dataset.touched = '1'; });
      sel.addEventListener('change', fillAmt);
      fillAmt();
      const m = methodPick(b, false);
      field(b, 'কোন নম্বরে নেবেন', inp('tel', { maxLength: 14, inputMode: 'numeric', name: 'number', value: st.me.my_number || '', placeholder: '01XXXXXXXXX' }), true);
      field(b, 'নোট', inp('text', { maxLength: 200, name: 'note', placeholder: 'ঐচ্ছিক, যেমন: দোকানে আগে টাকা চাইছে' }), false);
      b._m = m;
    }, 'অনুরোধ পাঠান', async (b) => {
      const amount = Number(b.querySelector('[name="amount"]').value);
      if (!amount || amount <= 0) return 'টাকার পরিমাণ দিন';
      return send('advance', amount, {
        p_request_id: b.querySelector('[name="order"]').value,
        p_method: b._m.get(),
        p_number: b.querySelector('[name="number"]').value.trim(),
        p_note: b.querySelector('[name="note"]').value.trim() || null,
      });
    });
  }

  function openBkash() {
    sheet(st.me.my_number ? 'বিকাশ নম্বর বদলান' : 'বিকাশ নম্বর দিন', (b) => {
      b.appendChild(el('p', 'rw-p', 'কুইক ডেলিভারির অগ্রিম টাকা কাস্টমার এই নম্বরে পাঠাবেন। নম্বর না দিলে কুইক ডেলিভারির অর্ডার নিতে পারবেন না।'));
      field(b, 'বিকাশ নম্বর', inp('tel', { maxLength: 14, inputMode: 'numeric', name: 'num', value: st.me.my_number || '', placeholder: '01XXXXXXXXX' }), true);
    }, 'সেভ করুন', async (b) => {
      const v = b.querySelector('[name="num"]').value.trim();
      if (!v) return 'নম্বর লিখুন';
      const { error } = await supabase.rpc('rider_set_bkash', { p_number: v });
      if (error) return /[ঀ-৿]/.test(error.message || '') ? error.message : 'সেভ হয়নি';
      toast('বিকাশ নম্বর সেভ হয়েছে');
      window.SF_HERO_BKASH = v;
      load();
      return null;
    });
  }

  function render() {
    root.textContent = '';
    const me = st.me;
    const bal = Number(me.balance) || 0;
    const bt = balText(bal);

    const hero = el('section', 'rw-hero ' + bt.cls);
    hero.append(el('small', null, bt.label), el('b', null, tk(bal)));
    hero.appendChild(el('p', null, bal < 0 ? 'কাস্টমার থেকে নেওয়া টাকা জমা দিলে হিসাব সমান হবে।' : bal > 0 ? 'চাইলে "টাকা তুলুন" দিয়ে নিতে পারেন।' : 'এখন কেউ কারো কাছে টাকা পায় না।'));
    root.appendChild(hero);

    const acts = el('div', 'rw-acts');
    const mk = (label, icon, fn, dis) => {
      const b = el('button', 'rw-act');
      b.type = 'button';
      b.innerHTML = '<i class="fas ' + icon + '" aria-hidden="true"></i>';
      b.appendChild(el('span', null, label));
      if (dis) b.disabled = true;
      b.addEventListener('click', fn);
      acts.appendChild(b);
    };
    mk('টাকা জমা দিন', 'fa-arrow-up', openDeposit);
    mk('টাকা তুলুন', 'fa-arrow-down', openWithdraw, bal <= 0);
    mk('অগ্রিম চান', 'fa-hand-holding-dollar', () => openAdvance(null));
    root.appendChild(acts);

    // বিকাশ নম্বর
    const bk = el('section', 'rw-bk' + (me.my_number ? '' : ' missing'));
    const im = el('img');
    im.src = '/market/pay/bkash.webp'; im.alt = ''; im.setAttribute('aria-hidden', 'true');
    const bt2 = el('div', 'rw-bk-t');
    bt2.append(el('small', null, 'আমার বিকাশ নম্বর (অগ্রিম এখানে আসবে)'), el('b', null, me.my_number ? BN(me.my_number) : 'দেওয়া নেই'));
    const eb = el('button', 'rw-bk-btn', me.my_number ? 'বদলান' : 'নম্বর দিন');
    eb.type = 'button';
    eb.addEventListener('click', openBkash);
    bk.append(im, bt2, eb);
    root.appendChild(bk);

    // অপেক্ষায় থাকা অনুরোধ
    const pend = st.reqs.filter((r) => r.status === 'pending');
    if (pend.length) {
      root.appendChild(el('h3', 'rw-h', 'অপেক্ষায়'));
      pend.forEach((r) => {
        const c = el('div', 'rw-pend');
        c.append(el('span', null, KIND[r.kind] + ' ' + tk(r.amount) + (r.order_no ? ' · ' + r.order_no : '')), el('small', null, 'ম্যানেজার দেখছেন · ' + dayText(r.created_at)));
        root.appendChild(c);
      });
    }

    // লেনদেন (অনুরোধের বাতিলও)
    const rejected = st.reqs.filter((r) => r.status === 'rejected').map((r) => ({ t: 'rej', at: r.decided_at || r.created_at, r }));
    const rows = st.entries.map((e) => ({ t: 'e', at: e.created_at, e })).concat(rejected).sort((a, b) => new Date(b.at) - new Date(a.at));
    root.appendChild(el('h3', 'rw-h', 'লেনদেন'));
    const list = el('div', 'rw-list');
    if (!rows.length) list.appendChild(el('p', 'rw-empty', 'এখনো কোনো লেনদেন নেই। কুইক ডেলিভারির অর্ডার সম্পন্ন হলে এখানে নিজে থেকে যোগ হবে।'));
    rows.forEach((x, i) => {
      const r = el('div', 'rw-row');
      if (i >= 5 && !st.showAll) r.hidden = true;
      const t = el('span', 'rw-row-t');
      if (x.t === 'e') {
        const no = x.e.delivery_requests && x.e.delivery_requests.order_no;
        t.append(el('span', null, (ENTRY[x.e.kind] || x.e.kind) + (no ? ' · ' + no : '')), el('small', null, dayText(x.e.created_at) + (x.e.kind === 'adjust' && x.e.note ? ' · ' + x.e.note : '')));
        const v = Number(x.e.amount);
        r.append(t, el('b', v < 0 ? 'neg' : 'pos', (v > 0 ? '+' : '−') + tk(v)));
      } else {
        t.append(el('span', null, KIND[x.r.kind] + ' ' + tk(x.r.amount) + ' গ্রহণ হয়নি'), el('small', null, (x.r.admin_note ? 'কারণ: ' + x.r.admin_note + ' · ' : '') + dayText(x.at)));
        r.classList.add('rej');
        r.append(t, el('b', 'zero', '—'));
      }
      list.appendChild(r);
    });
    root.appendChild(list);
    if (rows.length > 5) {
      const more = el('button', 'rw-more');
      more.type = 'button';
      more.setAttribute('aria-expanded', String(st.showAll));
      more.textContent = st.showAll ? 'কম দেখুন ▴' : 'সব লেনদেন দেখুন (' + BN(rows.length) + ') ▾';
      more.addEventListener('click', () => { st.showAll = !st.showAll; render(); });
      root.appendChild(more);
    }
    root.appendChild(el('p', 'rw-note', 'কুইক ডেলিভারির অর্ডার সম্পন্ন হলে হিসাব নিজে থেকে ওঠে: কাস্টমার থেকে নেওয়া নগদ ও আপনার বিকাশে আসা অগ্রিম কাটা যায়, দোকানে দেওয়া টাকা আর আপনার ডেলিভারি চার্জ যোগ হয়।'));
  }

  async function load() {
    const { data: me, error } = await supabase.rpc('rider_wallet_me');
    if (error || !me || !me.ok) {
      root.textContent = '';
      root.appendChild(el('p', 'rw-empty', error ? 'লোড করা যায়নি, আবার চেষ্টা করুন।' : 'এই অ্যাকাউন্টে রাইডার প্রোফাইল নেই।'));
      return null;
    }
    st.me = me;
    const [er, rq, od] = await Promise.all([
      supabase.from('rider_wallet_entries').select('id, kind, amount, note, created_at, delivery_requests(order_no)').eq('rider_id', me.rider_id).order('created_at', { ascending: false }).limit(100),
      supabase.from('rider_wallet_requests').select('id, kind, amount, status, admin_note, created_at, decided_at, delivery_requests(order_no)').eq('rider_id', me.rider_id).order('created_at', { ascending: false }).limit(50),
      supabase.from('delivery_requests').select('id, order_no, order_type, items_total, purchase_total, is_market').eq('accepted_rider_id', me.rider_id).eq('status', 'confirmed').order('created_at', { ascending: false }),
    ]);
    st.entries = er.data || [];
    st.reqs = (rq.data || []).map((r) => ({ ...r, order_no: r.delivery_requests && r.delivery_requests.order_no }));
    st.orders = (od.data || []).map((o) => ({ ...o, need: Number(o.order_type === 'anything' ? o.purchase_total : o.items_total) || 0 }));
    render();
    return me;
  }

  root.innerHTML = window.SFSkeleton ? window.SFSkeleton.html('card', 2) : '';
  const me = await load();
  if (!me) return;
  if (params.get('advance')) openAdvance(params.get('advance'));
  else if (params.get('bkash') === '1') openBkash();
}
