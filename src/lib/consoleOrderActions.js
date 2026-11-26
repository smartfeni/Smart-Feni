// ============================================================
// consoleOrderActions.js — /console/order পেজের কাজের বোতাম ও নিচের শিট (ধাপ ৪ ভাগ ২)
// পুরনো /admin/delivery-orders-এর হুবহু RPC (নতুন DB বদল নেই, অনুমতি সার্ভারে চেক):
//   admin_publish_delivery_orders(p_ids)            পাবলিশ
//   admin_hold_delivery_orders(p_ids, p_hold)       অপেক্ষায় রাখা / টাইমার চালু
//   admin_assignable_riders(p_category)             রাইডারের তালিকা
//   admin_assign_delivery_order(p_request_id, p_rider_id, p_price)
//   admin_transfer_delivery_order(p_request_id, p_new_rider_id, p_price)
//   admin_cancel_order / admin_reopen_order(p_request_id, p_reason)
//   admin_alert_riders(p_request_id, p_message, p_scope, p_upazila)
//   admin_add_order_note(p_request_id, p_note)
//   admin_review_release(p_request_id, p_approve, p_note)
//   ডিল চ্যাট: window.openChatModal({ channel:'admin', deal:'admin' })
// প্রতিটা কাজের আগে শিটে নিশ্চিত করতে হয়। সফল হলে reload() দিয়ে পেজ নতুন করে আঁকা।
// স্টাইল: order.astro-র is:global (.oa-*)
// ============================================================
import { supabase } from './supabase.js';
import { bn } from './consoleApp.js';
import { money } from './consoleOrders.js';

const STATUS_BN = {
  open: 'খোলা', confirmed: 'কনফার্ম', delivered: 'ডেলিভারড', completed: 'সম্পন্ন',
  cancelled: 'বাতিল', expired: 'মেয়াদ শেষ', disputed: 'ডিসপিউট',
};

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
const toast = (t, type = 'success') => window.showToast?.(t, type);

// ---------------- শিট ----------------
let sheet = null;
function ensureSheet() {
  if (sheet) return sheet;
  const wrap = el('div', 'oa-sheet');
  wrap.hidden = true;
  const box = el('form', 'oa-box');
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.noValidate = true;
  const title = el('h3', 'oa-title');
  const line = el('p', 'oa-line');
  const bodyEl = el('div', 'oa-body');
  const msg = el('p', 'oa-msg');
  msg.hidden = true;
  const btns = el('div', 'oa-btns');
  const cancel = el('button', 'oa-btn', 'বাদ দিন');
  cancel.type = 'button';
  const ok = el('button', 'oa-btn primary');
  ok.type = 'submit';
  btns.appendChild(cancel);
  btns.appendChild(ok);
  box.append(title, line, bodyEl, msg, btns);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
  const close = () => { wrap.hidden = true; document.body.style.overflow = ''; };
  cancel.addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !wrap.hidden) close(); });
  sheet = { wrap, box, title, line, bodyEl, msg, ok, cancel, close, onSubmit: null };
  box.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!sheet.onSubmit || ok.disabled) return;
    if (window.SFValidateForm && !window.SFValidateForm(box)) return;
    msg.hidden = true;
    ok.disabled = true;
    const label = ok.textContent;
    ok.textContent = 'হচ্ছে…';
    let res;
    try { res = await sheet.onSubmit(bodyEl); } catch (err) { res = { error: 'হয়নি, আবার চেষ্টা করুন।' }; }
    ok.textContent = label;
    ok.disabled = false;
    if (res && res.error) { msg.textContent = res.error; msg.hidden = false; return; }
    close();
  });
  return sheet;
}

// opts: { title, line, build(bodyEl), okText, danger, submit(bodyEl) → {error}|undefined }
function openSheet(opts) {
  const s = ensureSheet();
  s.title.textContent = opts.title;
  s.line.textContent = opts.line || '';
  s.line.hidden = !opts.line;
  s.bodyEl.textContent = '';
  if (opts.build) opts.build(s.bodyEl);
  s.msg.hidden = true;
  s.ok.textContent = opts.okText || 'নিশ্চিত';
  s.ok.className = 'oa-btn ' + (opts.danger ? 'danger' : 'primary');
  s.ok.disabled = false;
  s.cancel.hidden = !!opts.single;
  s.onSubmit = opts.submit;
  s.wrap.hidden = false;
  document.body.style.overflow = 'hidden';
  const first = s.bodyEl.querySelector('input, textarea');
  if (first) setTimeout(() => first.focus(), 60);
}

function field(parent, label, input, required) {
  const id = 'oa-' + Math.random().toString(36).slice(2, 8);
  const wrap = el('div', 'oa-field');
  const l = el('label', null, label);
  l.htmlFor = id;
  if (required) {
    const m = el('span', 'required-mark', ' *');
    l.appendChild(m);
    input.required = true;
  }
  input.id = id;
  wrap.append(l, input);
  const err = el('small', 'field-error');
  err.dataset.errorFor = id;
  wrap.appendChild(err);
  parent.appendChild(wrap);
  return input;
}

function textArea(max, value = '') {
  const t = el('textarea', 'oa-input');
  t.rows = 3;
  t.maxLength = max;
  t.value = value;
  return t;
}

// ---------------- কাজগুলো ----------------
function orderLine(o) {
  return (o.category === 'ride' ? 'রাইড' : 'ডেলিভারি') + ' অর্ডার ' + o.order_no + (o.upazila ? ' · ' + o.upazila : '') + (o.price ? ' · ' + money(o.price) : '');
}

function publish(o, reload) {
  openSheet({
    title: 'পাবলিশ করবেন?',
    line: orderLine(o),
    build: (b) => b.appendChild(el('p', 'oa-hint', 'পাবলিশ করলে অনলাইন রাইডাররা অর্ডারটা দেখবে ও অফার দিতে পারবে। অটো-পাবলিশ টাইমার আর লাগবে না।')),
    okText: 'পাবলিশ করুন',
    submit: async () => {
      const { data, error } = await supabase.rpc('admin_publish_delivery_orders', { p_ids: [o.id] });
      if (error || !data || !data.ok) return { error: 'পাবলিশ করা যায়নি।' };
      toast(data.published ? 'অর্ডার পাবলিশ হয়েছে' : 'আগেই পাবলিশ বা বাতিল হয়ে গেছে');
      reload();
      return undefined;
    },
  });
}

async function hold(o, toHold, reload) {
  const { data, error } = await supabase.rpc('admin_hold_delivery_orders', { p_ids: [o.id], p_hold: toHold });
  if (error || !data || !data.ok) { toast('বদলানো যায়নি', 'error'); return; }
  toast(data.changed ? (toHold ? 'অপেক্ষায় রাখা হয়েছে, টাইমার বন্ধ' : 'টাইমার চালু হয়েছে') : 'আগের অবস্থাতেই ছিল');
  reload();
}

const ASSIGN_FAIL = {
  bad_price: 'চার্জ সঠিক নয়।',
  not_found: 'অর্ডারটি পাওয়া যায়নি।',
  rider_invalid: 'এই রাইডার এই অর্ডারের জন্য উপযুক্ত নন (বা কাস্টমার নিজেই)।',
  not_confirmed: 'অর্ডারটি এখন কনফার্ম অবস্থায় নেই।',
  already_picked_up: 'পিকআপ হয়ে গেছে, এখন রাইডার বদলানো যাবে না।',
  same_rider: 'এই রাইডারই এখন অর্ডারটি করছেন, অন্য রাইডার বাছুন।',
};

// multi = [{id, order_no}] হলে এক রাইডারকে অনেক অর্ডার (প্রতিটার নিজের চার্জে)
function assign(o, transfer, reload, multi = null) {
  let riders = [];
  let pick = null;
  let listBox = null;
  let search = null;
  let onlyOnline = null;

  const paint = () => {
    listBox.textContent = '';
    const q = search.value.trim().toLowerCase();
    const list = riders.filter((r) => (!onlyOnline.checked || r.online)
      && (!q || [r.name, r.phone, r.upazila].some((v) => (v || '').toLowerCase().includes(q))));
    if (!list.length) {
      listBox.appendChild(el('p', 'oa-hint', riders.length ? 'কোনো রাইডার মেলেনি।' : 'কোনো অনুমোদিত রাইডার নেই।'));
      return;
    }
    list.forEach((r) => {
      const b = el('button', 'oa-rider');
      b.type = 'button';
      b.setAttribute('aria-pressed', String(pick === r.rider_id));
      const left = el('span', 'oa-rider-t');
      left.appendChild(el('b', null, r.name || 'নামহীন'));
      left.appendChild(el('small', null, [r.phone, r.upazila, r.vehicle_type, r.total_completed ? bn(r.total_completed) + 'টা সম্পন্ন' : ''].filter(Boolean).join(' · ')));
      b.appendChild(left);
      const tags = el('span', 'oa-tags');
      if (r.is_own) tags.appendChild(el('span', 'oa-tag own', 'নিজস্ব'));
      tags.appendChild(el('span', 'oa-tag' + (r.online ? ' on' : ''), r.online ? 'অনলাইন' : 'অফলাইন'));
      b.appendChild(tags);
      b.addEventListener('click', () => { pick = r.rider_id; paint(); });
      listBox.appendChild(b);
    });
  };

  openSheet({
    title: transfer ? 'রাইডার বদলান' : multi ? bn(multi.length) + 'টা অর্ডার এক রাইডারকে' : 'রাইডারকে দিন',
    line: multi ? multi.map((x) => x.order_no).join(', ') : orderLine(o),
    okText: transfer ? 'রাইডার বদলান' : 'রাইডারকে দিন',
    build: (b) => {
      if (multi) {
        b.appendChild(el('p', 'oa-hint', 'প্রতিটা অর্ডার তার নিজের ডেলিভারি চার্জেই রাইডারকে দেওয়া হবে।'));
      } else {
      const price = el('input', 'oa-input');
      price.type = 'number';
      price.inputMode = 'numeric';
      price.min = '1';
      price.max = '1000000';
      price.name = 'price';
      price.value = o.price ? String(Math.round(o.price)) : '';
      field(b, o.category === 'ride' ? 'ভাড়া (৳)' : 'ডেলিভারি চার্জ (৳)', price, true);
      }

      search = el('input', 'oa-input');
      search.type = 'search';
      search.placeholder = 'নাম, ফোন বা উপজেলা';
      search.setAttribute('aria-label', 'রাইডার খুঁজুন');
      b.appendChild(search);
      const chk = el('label', 'oa-check');
      onlyOnline = el('input');
      onlyOnline.type = 'checkbox';
      chk.append(onlyOnline, document.createTextNode(' শুধু অনলাইন রাইডার'));
      b.appendChild(chk);
      listBox = el('div', 'oa-riders');
      listBox.appendChild(el('p', 'oa-hint', 'রাইডার লোড হচ্ছে…'));
      b.appendChild(listBox);
      search.addEventListener('input', paint);
      onlyOnline.addEventListener('change', paint);
      if (transfer) b.appendChild(el('p', 'oa-hint', 'পুরনো রাইডার, নতুন রাইডার ও কাস্টমারকে জানানো হবে।'));

      supabase.rpc('admin_assignable_riders', { p_category: o.category }).then(({ data, error }) => {
        if (error) { listBox.textContent = ''; listBox.appendChild(el('p', 'oa-msg', 'রাইডার লোড হয়নি।')); return; }
        riders = (Array.isArray(data) ? data : []).filter((r) => !transfer || !o.accepted_rider_id || r.rider_id !== o.accepted_rider_id);
        paint();
      });
    },
    submit: async (b) => {
      const rider = riders.find((r) => r.rider_id === pick);
      if (!rider) return { error: 'একজন রাইডার বাছুন।' };
      if (multi) {
        const pr = await supabase.rpc('admin_search_orders', { p_group: 'live', p_filter: 'unpublished', p_limit: 100 });
        const map = {};
        ((pr.data && pr.data.items) || []).forEach((it) => { map[it.id] = it.price; });
        let done = 0;
        const fails = [];
        for (const x of multi) {
          const pz = map[x.id];
          if (!pz) { fails.push(x.order_no); continue; }
          const res = await supabase.rpc('admin_assign_delivery_order', { p_request_id: x.id, p_rider_id: rider.rider_id, p_price: pz });
          if (res.error || !res.data || !res.data.ok) fails.push(x.order_no); else done += 1;
        }
        if (done) { toast(bn(done) + 'টা অর্ডার ' + (rider.name || 'রাইডার') + '-কে দেওয়া হয়েছে' + (fails.length ? ' · ' + bn(fails.length) + 'টা হয়নি' : ''), fails.length ? 'error' : 'success'); reload(); }
        if (!done) return { error: 'একটাও দেওয়া যায়নি (' + fails.join(', ') + ')। অর্ডারগুলো আর অপেক্ষায় নেই বা চার্জ ঠিক নেই।' };
        return undefined;
      }
      const price = parseFloat(b.querySelector('input[name="price"]').value);
      if (isNaN(price) || price <= 0 || price > 1000000) return { error: 'চার্জ সঠিক দিন।' };
      const { data, error } = transfer
        ? await supabase.rpc('admin_transfer_delivery_order', { p_request_id: o.id, p_new_rider_id: rider.rider_id, p_price: price })
        : await supabase.rpc('admin_assign_delivery_order', { p_request_id: o.id, p_rider_id: rider.rider_id, p_price: price });
      if (error) return { error: 'দেওয়া যায়নি।' };
      if (!data || !data.ok) {
        return { error: data && data.reason === 'not_open' ? 'অর্ডারটি আর খোলা নেই (' + (STATUS_BN[data.status] || data.status || '') + ')।' : (ASSIGN_FAIL[data && data.reason] || 'দেওয়া যায়নি।') };
      }
      toast(transfer ? (rider.name || 'রাইডার') + '-কে দেওয়া হয়েছে, তিন পক্ষকে জানানো হয়েছে' : (rider.name || 'রাইডার') + '-কে দেওয়া হয়েছে');
      reload();
      return undefined;
    },
  });
}

function cancelOrReopen(o, reopen, reload) {
  openSheet({
    title: reopen ? 'মার্কেটে ফেরত দেবেন?' : 'অর্ডার বাতিল করবেন?',
    line: orderLine(o),
    danger: !reopen,
    okText: reopen ? 'মার্কেটে ফেরত দিন' : 'বাতিল করুন',
    build: (b) => {
      b.appendChild(el('p', 'oa-hint', reopen
        ? 'রাইডারের কাছ থেকে সরিয়ে অর্ডারটা আবার সবার জন্য খোলা হবে। পুরনো রাইডার ও কাস্টমারকে জানানো হবে।'
        : 'বাতিল করলে আর ফেরানো যাবে না। কাস্টমার ও (থাকলে) রাইডারকে কারণসহ জানানো হবে।'));
      const t = textArea(300);
      t.name = 'reason';
      t.minLength = 3;
      field(b, 'কারণ', t, true);
    },
    submit: async (b) => {
      const reason = b.querySelector('textarea[name="reason"]').value.trim();
      if (reason.length < 3) return { error: 'কারণ লিখুন (কমপক্ষে ৩ অক্ষর)।' };
      const { data, error } = await supabase.rpc(reopen ? 'admin_reopen_order' : 'admin_cancel_order', { p_request_id: o.id, p_reason: reason });
      if (error) return { error: 'হয়নি, আবার চেষ্টা করুন।' };
      if (!data || !data.ok) {
        const r = data && data.reason;
        if (r === 'reason_too_long') return { error: 'কারণ সর্বোচ্চ ৩০০ অক্ষর।' };
        if (r === 'not_cancellable') return { error: 'এই অর্ডার এখন আর বাতিল করা যাবে না (' + (STATUS_BN[data.status] || data.status) + ')।' };
        if (r === 'not_confirmed' || r === 'already_picked_up') return { error: 'অর্ডারটি আর "কনফার্ম, পিকআপের আগে" অবস্থায় নেই, তাই ফেরানো যাবে না।' };
        return { error: 'হয়নি।' };
      }
      toast(reopen ? 'মার্কেটে ফেরত গেছে, সংশ্লিষ্টদের জানানো হয়েছে' : 'অর্ডার বাতিল হয়েছে, দুই পক্ষকে জানানো হয়েছে');
      reload();
      return undefined;
    },
  });
}

function alertRiders(o, reload) {
  openSheet({
    title: 'রাইডারদের এলার্ট দিন',
    line: orderLine(o),
    okText: 'এলার্ট পাঠান',
    build: (b) => {
      const g = el('div', 'oa-radios');
      [['online', 'শুধু অনলাইন রাইডার'], ['all', 'সব ভেরিফায়েড রাইডার (অফলাইন সহ)']].forEach(([v, t], i) => {
        const l = el('label', 'oa-check');
        const r = el('input');
        r.type = 'radio';
        r.name = 'scope';
        r.value = v;
        r.checked = i === 0;
        l.append(r, document.createTextNode(' ' + t));
        g.appendChild(l);
      });
      b.appendChild(g);
      const t = textArea(300, (o.category === 'ride' ? 'নতুন রাইড রিকোয়েস্ট' : 'নতুন ডেলিভারি রিকোয়েস্ট') + ' #' + o.order_no + ' — ' + (o.upazila || '') + (o.price ? ', ' + money(o.price) : '') + '। অফার দিন!');
      t.name = 'msg';
      field(b, 'মেসেজ', t, false);
      b.appendChild(el('p', 'oa-hint', 'একই অর্ডারে ৫ মিনিটে একবার এলার্ট দেওয়া যায়।'));
    },
    submit: async (b) => {
      const scope = (b.querySelector('input[name="scope"]:checked') || {}).value || 'online';
      const { data, error } = await supabase.rpc('admin_alert_riders', {
        p_request_id: o.id,
        p_message: b.querySelector('textarea[name="msg"]').value.trim() || null,
        p_scope: scope,
        p_upazila: null,
      });
      if (error) return { error: 'পাঠানো যায়নি।' };
      if (!data || !data.ok) {
        const r = data && data.reason;
        if (r === 'cooldown') { const s = data.retry_in || 0; return { error: 'সম্প্রতি এলার্ট দেওয়া হয়েছে। ' + bn(Math.floor(s / 60)) + ' মিনিট ' + bn(s % 60) + ' সেকেন্ড পর আবার চেষ্টা করুন।' }; }
        if (r === 'not_published') return { error: 'অর্ডারটি এখনো পাবলিশ হয়নি। আগে পাবলিশ করুন।' };
        if (r === 'not_open') return { error: 'অর্ডারটি আর খোলা নেই।' };
        return { error: 'অর্ডারটি পাওয়া যায়নি।' };
      }
      if (!data.sent) return { error: 'মিলে যাওয়া কোনো রাইডার পাওয়া যায়নি। "সব ভেরিফায়েড রাইডার" দিয়ে দেখুন।' };
      toast(bn(data.sent) + ' জন রাইডারকে এলার্ট পাঠানো হয়েছে');
      reload();
      return undefined;
    },
  });
}

function addNote(o, reload) {
  openSheet({
    title: 'নোট যোগ করুন',
    line: orderLine(o),
    okText: 'সেভ করুন',
    build: (b) => {
      const t = textArea(500);
      t.name = 'note';
      field(b, 'নোট (টাইমলাইনে দেখাবে, কাস্টমার/রাইডার দেখে না)', t, true);
    },
    submit: async (b) => {
      const note = b.querySelector('textarea[name="note"]').value.trim();
      if (!note) return { error: 'নোট লিখুন।' };
      const { data, error } = await supabase.rpc('admin_add_order_note', { p_request_id: o.id, p_note: note });
      if (error || !data || !data.ok) return { error: data && data.reason === 'bad_note' ? 'নোট ১ থেকে ৫০০ অক্ষরের হতে হবে।' : 'সেভ হয়নি।' };
      toast('নোট সেভ হয়েছে');
      reload();
      return undefined;
    },
  });
}

function reviewRelease(o, approve, reload) {
  openSheet({
    title: approve ? 'ছাড়ার অনুরোধ অনুমোদন করবেন?' : 'ছাড়ার অনুরোধ নাকচ করবেন?',
    line: orderLine(o),
    danger: false,
    okText: approve ? 'অনুমোদন, মার্কেটে ফেরান' : 'নাকচ করুন',
    build: (b) => {
      if (approve) {
        b.appendChild(el('p', 'oa-hint', 'অনুমোদন করলে অর্ডারটা এই রাইডারের কাছ থেকে সরে আবার মার্কেটে যাবে।'));
      } else {
        b.appendChild(el('p', 'oa-hint', 'রাইডারই অর্ডারটা করবেন। চাইলে রাইডারকে কিছু জানাতে পারেন।'));
        const t = textArea(300);
        t.name = 'note';
        field(b, 'রাইডারকে বার্তা (ঐচ্ছিক)', t, false);
      }
    },
    submit: async (b) => {
      const t = b.querySelector('textarea[name="note"]');
      const note = t ? (t.value.trim().slice(0, 300) || null) : null;
      const { data, error } = await supabase.rpc('admin_review_release', { p_request_id: o.id, p_approve: approve, p_note: note });
      if (error || !data || !data.ok) {
        const m = { no_request: 'এই অনুরোধ আর খোলা নেই।', already_picked_up: 'রাইডার পিকআপ করে ফেলেছেন, এখন আর ফেরানো যাবে না।' };
        return { error: m[data && data.reason] || 'হয়নি, আবার চেষ্টা করুন।' };
      }
      toast(approve ? 'অনুমোদন হয়েছে, অর্ডার মার্কেটে ফিরেছে' : 'নাকচ হয়েছে, রাইডারকে জানানো হয়েছে');
      reload();
      return undefined;
    },
  });
}

// "আরও" শিট: কাজের তালিকা
function moreSheet(items) {
  openSheet({
    title: 'আরও কাজ',
    okText: 'বন্ধ',
    single: true,
    build: (b) => {
      const list = el('div', 'oa-list');
      items.forEach((it) => {
        const btn = el(it.href ? 'a' : 'button', 'oa-li' + (it.danger ? ' danger' : ''), it.label);
        if (it.href) btn.href = it.href; else btn.type = 'button';
        btn.addEventListener('click', () => {
          if (it.href) return;
          sheet.close();
          setTimeout(it.run, 60);
        });
        list.appendChild(btn);
      });
      b.appendChild(list);
    },
    submit: async () => undefined,
  });
}

// ---------------- বোতামের সারি ----------------
// st = orderStatusOf(o): pending | hold | open | confirmed | delivered | disputed | completed | cancelled | expired
export function renderOrderActions({ bar, data, st, canManage, reload, chatBtn }) {
  const o = { ...data.order, price: data.order.price };
  const c = data.customer || {};
  const r = data.rider || null;
  const btn = (label, cls, run) => {
    const b = el('button', 'od-btn' + (cls ? ' ' + cls : ''), label);
    b.type = 'button';
    b.addEventListener('click', run);
    bar.appendChild(b);
    return b;
  };

  if (!canManage) {
    if (chatBtn) bar.appendChild(chatBtn);
    bar.appendChild(el('p', 'oa-hint', 'এই অর্ডারে কাজ করার অনুমতি নেই, শুধু দেখা যাবে।'));
    return;
  }

  const unpub = st === 'pending' || st === 'hold';
  const more = [];

  if (unpub) {
    btn('পাবলিশ করুন', 'primary', () => publish(o, reload));
    btn('রাইডারকে দিন', '', () => assign(o, false, reload));
    more.push({ label: 'ডিল চ্যাট (কাস্টমারের সাথে দাম ঠিক করা)', run: () => window.openChatModal?.({ requestId: o.id, otherPartyName: c.name || 'কাস্টমার', channel: 'admin', deal: 'admin' }) });
    more.push(st === 'hold'
      ? { label: 'অটো-পাবলিশ টাইমার চালু করুন', run: () => hold(o, false, reload) }
      : { label: 'অপেক্ষায় রাখুন (টাইমার বন্ধ)', run: () => hold(o, true, reload) });
  } else if (st === 'open') {
    const a = btn('রাইডারদের এলার্ট দিন', 'primary', () => alertRiders(o, reload));
    const cd = Number(data.alert_cooldown_secs) || 0;
    if (cd > 0) {
      a.disabled = true;
      a.textContent = 'এলার্ট দেওয়া যাবে ' + bn(Math.ceil(cd / 60)) + ' মিনিট পর';
      setTimeout(() => { a.disabled = false; a.textContent = 'রাইডারদের এলার্ট দিন'; }, cd * 1000);
    }
    btn('রাইডারকে দিন', '', () => assign(o, false, reload));
  } else if (st === 'confirmed' || st === 'disputed') {
    btn('রাইডার বদলান', st === 'confirmed' && !o.release_requested_at ? '' : 'primary', () => assign(o, true, reload));
    if (st === 'disputed') {
      const d = el('a', 'od-btn', 'ডিসপিউট পেজ ↗');
      d.href = '/admin/delivery-disputes?q=' + encodeURIComponent(o.order_no);
      bar.appendChild(d);
    }
    more.push({ label: 'মার্কেটে ফেরত দিন', run: () => cancelOrReopen(o, true, reload) });
  }

  if (chatBtn) bar.appendChild(chatBtn);
  more.push({ label: 'নোট যোগ করুন', run: () => addNote(o, reload) });
  if (c.phone) more.push({ label: 'কাস্টমারকে কল · ' + c.phone, href: 'tel:' + String(c.phone).replace(/[^\d+]/g, '') });
  if (r && r.phone) more.push({ label: 'রাইডারকে কল · ' + r.phone, href: 'tel:' + String(r.phone).replace(/[^\d+]/g, '') });
  if (['open', 'confirmed', 'delivered', 'disputed'].includes(o.eff_status || o.status) || unpub) {
    more.push({ label: 'অর্ডার বাতিল করুন', danger: true, run: () => cancelOrReopen(o, false, reload) });
  }
  btn('আরও ⋯', 'oa-more', () => moreSheet(more));
}

// ছাড়ার অনুরোধ সেকশনের দুই বোতাম
export function renderReleaseButtons({ box, data, canManage, reload }) {
  if (!canManage) return;
  const o = data.order;
  const row = el('div', 'oa-row');
  const yes = el('button', 'od-btn primary', 'অনুমোদন (মার্কেটে ফেরান)');
  yes.type = 'button';
  yes.addEventListener('click', () => reviewRelease(o, true, reload));
  const no = el('button', 'od-btn', 'না, রাইডারই করবেন');
  no.type = 'button';
  no.addEventListener('click', () => reviewRelease(o, false, reload));
  row.append(yes, no);
  box.appendChild(row);
}

// ---------------- ব্যাচ (তালিকা পেজের "এলাকা ও দোকান" ভিউ) ----------------
export function publishMany(list, label, reload) {
  openSheet({
    title: bn(list.length) + 'টা অর্ডার পাবলিশ করবেন?',
    line: label,
    build: (b) => {
      b.appendChild(el('p', 'oa-hint', list.map((x) => x.order_no).join(', ')));
      b.appendChild(el('p', 'oa-hint', 'পাবলিশ করলে অনলাইন রাইডাররা এগুলো দেখবে ও অফার দিতে পারবে।'));
    },
    okText: 'পাবলিশ করুন',
    submit: async () => {
      const { data, error } = await supabase.rpc('admin_publish_delivery_orders', { p_ids: list.map((x) => x.id) });
      if (error || !data || !data.ok) return { error: 'পাবলিশ করা যায়নি।' };
      toast(bn(data.published || 0) + 'টা পাবলিশ হয়েছে' + (data.skipped ? ' · ' + bn(data.skipped) + 'টা আগেই পাবলিশ/বাতিল' : ''));
      reload();
      return undefined;
    },
  });
}

export function assignMany(list, reload) {
  assign({ category: 'delivery' }, false, reload, list);
}
