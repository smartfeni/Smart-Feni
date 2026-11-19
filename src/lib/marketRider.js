// path: src/lib/marketRider.js
// ============================================================
// কুইক ডেলিভারি — রাইডারের কার্ডের অংশ (delivery-hero ও pro/hero/delivery দুই জায়গায় একই)। ধাপ ৮।
// - marketBadge(req): ফিড/চলমান কার্ডের ব্যাজ (কুইক ডেলিভারি / অর্ডার এনিথিং / পাঠান)
// - marketRiderHtml(req, esc): অর্ডার এনিথিং ও পাঠানোর তথ্য + দাম পাঠানোর ফর্ম + টাকার হিসাব (HTML, সব লেখা esc করা)
// - bindMarketRider(card, req, supabase, onDone): ছবি (signed URL), দাম পাঠানো (rider_submit_purchase_price), রসিদ আপলোড
// ছবি/রসিদ: private bucket chat-images/<request_id>/... (কাস্টমার, অ্যাসাইন হওয়া রাইডার, অ্যাডমিন পড়ে)
// ============================================================
import { compressImage } from './imageCompress.js';

const BN = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const TK = (n) => '৳' + BN(Math.round(Number(n) || 0));

export function marketBadge(req) {
  const t = req.order_type === 'anything' ? ['fa-bag-shopping', 'অর্ডার এনিথিং'] : req.order_type === 'send' ? ['fa-box', 'পাঠান / এনে দাও'] : ['fa-bolt', 'কুইক ডেলিভারি'];
  return '<span style="display:inline-flex;align-items:center;gap:6px;margin-bottom:8px;padding:4px 11px;border-radius:999px;background:linear-gradient(135deg,#E8551C,#FF8A55);color:#fff;font-size:0.78rem;font-weight:800;letter-spacing:0.2px;"><i class="fas ' + t[0] + '"></i> ' + t[1] + '</span>';
}

function cleanDesc(req) {
  return String(req.description || '').replace(/^(যেকোনো কিছু|পাঠান)( · [^·]+)?? · /, '');
}

function telBtn(phone, label) {
  const p = String(phone || '').replace(/[^\d+]/g, '');
  if (!p) return '';
  return '<a href="tel:' + p + '" style="display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:0 14px;border-radius:12px;background:#1B2A4A;color:#fff;font-weight:700;text-decoration:none;font-size:0.9rem;"><i class="fas fa-phone"></i> ' + label + '</a>';
}

export function marketRiderHtml(req, esc) {
  const isSend = req.order_type === 'send';
  const verified = !!req.advance_verified;
  const pickupDone = !!req.pickup_done_at;
  const canQuote = !isSend && req.status === 'confirmed' && !pickupDone && !verified;
  const lines = Array.isArray(req.purchase_lines) ? req.purchase_lines : [];
  const photos = Array.isArray(req.item_photo_paths) ? req.item_photo_paths : [];
  const SIZE = { small: 'ছোট', medium: 'মাঝারি', large: 'বড়' };

  let h = '<div style="margin:10px 0;padding:14px;border-radius:18px;background:#FFF8F3;border:1.5px solid #FFD9C4;">';
  h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><img src="/market/icons/' + (isSend ? 'scooter' : 'bags') + '.webp" alt="" aria-hidden="true" style="width:28px;height:28px;object-fit:contain;" /><b style="flex:1;color:#1B2A4A;font-size:1rem;">' + (isSend ? 'কী নিতে হবে' : 'কী কিনবেন') + '</b>' + (isSend && req.parcel_size ? '<span style="font-size:0.78rem;font-weight:800;color:#9A3412;background:#FFE3D1;padding:3px 9px;border-radius:999px;">সাইজ: ' + (SIZE[req.parcel_size] || '') + '</span>' : '') + '</div>';
  h += '<p style="margin:0 0 8px;font-size:0.98rem;line-height:1.6;color:#1B2A4A;white-space:pre-line;font-weight:600;">' + esc(cleanDesc(req)) + '</p>';
  if (photos.length) {
    h += '<div data-qd-photos style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;">' + photos.map((p) => '<img data-qd-path="' + esc(p) + '" alt="অর্ডারের ছবি" style="width:78px;height:78px;object-fit:cover;border-radius:12px;background:#F3F5F9;cursor:zoom-in;" />').join('') + '</div>';
  }
  if (isSend) {
    h += '<div style="display:flex;flex-wrap:wrap;gap:8px;margin:6px 0;">' + telBtn(req.pickup_contact_phone, 'পিকআপে কল') + (req.drop_contact_phone ? telBtn(req.drop_contact_phone, 'প্রাপককে কল' + (req.drop_contact_name ? ' (' + esc(req.drop_contact_name) + ')' : '')) : '') + '</div>';
  }

  if (!isSend) {
    if (lines.length) {
      h += '<div style="margin-top:6px;padding:10px 12px;border-radius:12px;background:#fff;border:1px solid #F0E4DA;">';
      lines.forEach((l, i) => { h += '<div style="display:flex;justify-content:space-between;padding:3px 0;font-weight:600;color:#33415C;"><span>' + esc(l.label || ('দাম ' + BN(i + 1))) + '</span><b style="color:#1B2A4A;">' + TK(l.amount) + '</b></div>'; });
      h += '<div style="display:flex;justify-content:space-between;padding-top:6px;margin-top:4px;border-top:1.5px dashed #E2E7EF;font-weight:800;color:#1B2A4A;"><span>পাঠানো মোট</span><span>' + TK(req.purchase_total) + '</span></div></div>';
    }
    if (canQuote) {
      const rows = (lines.length ? lines : [{ label: '', amount: '' }]).map((l) => qRow(esc(l.label || ''), l.amount === '' ? '' : String(Math.round(Number(l.amount) || 0)))).join('');
      h += '<div data-qd-quote style="margin-top:10px;padding:12px;border-radius:14px;background:#fff;border:1.5px solid #FFD9C4;">'
        + '<b style="display:block;color:#1B2A4A;margin-bottom:4px;">দোকানে দাম জেনে পাঠান</b>'
        + '<p style="margin:0 0 8px;font-size:0.82rem;color:#5A6B85;font-weight:600;">কাস্টমার দাম দেখে অগ্রিম দেবেন। অগ্রিম যাচাইয়ের আগে কিনবেন না।</p>'
        + '<div data-qd-rows>' + rows + '</div>'
        + '<button type="button" data-qd-addrow style="min-height:40px;border:0;background:none;color:#E8551C;font-weight:800;font-family:inherit;cursor:pointer;padding:0;">+ আরেকটা দাম</button>'
        + '<label style="display:block;margin-top:8px;font-size:0.82rem;font-weight:700;color:#4A5568;">রসিদের ছবি (ঐচ্ছিক)<input type="file" accept="image/*" data-qd-receipt style="display:block;margin-top:4px;width:100%;" /></label>'
        + '<p data-qd-err style="display:none;margin:8px 0 0;color:#B42318;font-weight:700;font-size:0.88rem;"></p>'
        + '<button type="button" data-qd-send style="display:block;width:100%;margin-top:10px;min-height:50px;border:0;border-radius:14px;background:#FF6B35;color:#fff;font-weight:800;font-size:1rem;font-family:inherit;cursor:pointer;">' + (lines.length ? 'দাম আবার পাঠান' : 'দাম পাঠান') + '</button>'
        + '</div>';
    }
  }

  // টাকার হিসাব
  if (verified) {
    const due = Number(req.cod_due);
    if (!isSend && !pickupDone) {
      h += '<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#FDECEA;color:#A3261B;font-weight:700;font-size:0.88rem;"><i class="fas fa-wallet"></i> দোকানে ' + TK(req.purchase_total) + ' দিয়ে কিনুন (রসিদ থাকলে রাখুন)।</div>';
    }
    h += '<div style="display:flex;justify-content:space-between;padding:8px 0 4px;font-weight:600;color:#33415C;"><span>অগ্রিম পাওয়া গেছে</span><b style="color:#17663F;">' + TK(req.advance_verified_amount) + '</b></div>';
    h += '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;padding:12px 14px;border-radius:14px;background:#1B2A4A;color:#fff;"><span style="font-weight:700;">কাস্টমারের কাছে নেবেন</span><b style="font-size:1.45rem;">' + TK(isFinite(due) ? due : 0) + '</b></div>';
  } else if (req.status === 'confirmed') {
    h += '<div style="margin-top:10px;padding:10px 12px;border-radius:12px;background:#FFF7ED;color:#9A3412;font-weight:700;font-size:0.88rem;">' + (isSend ? 'কাস্টমার চার্জ অগ্রিম দেবেন। যাচাই হলেই নিতে যান।' : 'অগ্রিম যাচাইয়ের পর এখানে কাস্টমারের কাছে নেওয়ার টাকা দেখাবে।') + '</div>';
  }
  h += '</div>';
  return h;
}

function qRow(label, amount) {
  return '<div data-qd-row style="display:flex;gap:8px;margin-bottom:8px;">'
    + '<input data-qd-lbl maxlength="80" placeholder="কী (যেমন: চাল ২ কেজি)" value="' + label + '" style="flex:1;min-width:0;height:46px;border:1.5px solid #E2E7EF;border-radius:12px;padding:0 10px;font-size:15px;font-family:inherit;" />'
    + '<input data-qd-amt type="number" inputmode="numeric" min="1" placeholder="৳" value="' + amount + '" style="width:96px;height:46px;border:1.5px solid #E2E7EF;border-radius:12px;padding:0 10px;font-size:16px;font-family:inherit;" />'
    + '</div>';
}

export function bindMarketRider(card, req, supabase, onDone) {
  // ছবি
  card.querySelectorAll('img[data-qd-path]').forEach(async (im) => {
    try {
      const { data } = await supabase.storage.from('chat-images').createSignedUrl(im.dataset.qdPath, 3600);
      if (data && data.signedUrl) im.src = data.signedUrl;
    } catch (_) { /* ছবি না এলেও চলবে */ }
    im.addEventListener('click', () => { if (im.src) window.open(im.src, '_blank', 'noopener'); });
  });

  const box = card.querySelector('[data-qd-quote]');
  if (!box) return;
  box.querySelector('[data-qd-addrow]').addEventListener('click', () => {
    const rows = box.querySelector('[data-qd-rows]');
    if (rows.children.length >= 15) return;
    rows.insertAdjacentHTML('beforeend', qRow('', ''));
  });
  const err = (m) => { const e = box.querySelector('[data-qd-err]'); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
  const btn = box.querySelector('[data-qd-send]');
  btn.addEventListener('click', async () => {
    const lines = [];
    box.querySelectorAll('[data-qd-row]').forEach((r) => {
      const a = Number(r.querySelector('[data-qd-amt]').value);
      const l = r.querySelector('[data-qd-lbl]').value.trim();
      if (a > 0) lines.push({ label: l, amount: a });
    });
    if (!lines.length) { err('অন্তত একটা দাম লিখুন'); return; }
    err('');
    btn.disabled = true;
    const old = btn.textContent;
    btn.textContent = 'পাঠানো হচ্ছে…';
    try {
      let receipt = null;
      const f = box.querySelector('[data-qd-receipt]').files && box.querySelector('[data-qd-receipt]').files[0];
      if (f) {
        let blob = f;
        try { blob = await compressImage(f); } catch (_) { blob = f; }
        const path = req.id + '/receipt-' + Date.now() + '.jpg';
        const up = await supabase.storage.from('chat-images').upload(path, blob, { contentType: 'image/jpeg', upsert: false });
        if (!up.error) receipt = path;
      }
      const { error } = await supabase.rpc('rider_submit_purchase_price', { p_request_id: req.id, p_lines: lines, p_receipt: receipt });
      if (error) { err(error.message || 'পাঠানো যায়নি'); btn.disabled = false; btn.textContent = old; return; }
      if (window.showToast) window.showToast('দাম পাঠানো হয়েছে, কাস্টমার অগ্রিম দিলে জানানো হবে', 'success');
      if (typeof onDone === 'function') onDone();
    } catch (_) {
      err('ইন্টারনেটে সমস্যা, আবার চেষ্টা করুন');
      btn.disabled = false; btn.textContent = old;
    }
  });
}

// ============================================================
// রাইডারের "আজকের হিসাব" কার্ড (কুইক ডেলিভারি, ঢাকার আজকের দিন)। ধাপ ৯।
// কলাম rider_cod_collected / rider_purchase_paid / rider_earning ট্রিগার market_on_complete বসায়।
// ============================================================
export async function renderRiderToday(supabase, riderId, anchorEl) {
  if (!riderId || !anchorEl || !anchorEl.parentNode) return;
  let box = document.getElementById('qdRiderToday');
  try {
    const DH = 6 * 3600 * 1000;
    const day = new Date(Date.now() + DH).toISOString().slice(0, 10);
    const from = new Date(Date.parse(day + 'T00:00:00Z') - DH).toISOString();
    const { data } = await supabase
      .from('delivery_requests')
      .select('rider_cod_collected, rider_purchase_paid, rider_earning, rider_settled_at')
      .eq('accepted_rider_id', riderId)
      .eq('is_market', true)
      .eq('status', 'completed')
      .gte('market_completed_at', from);
    const list = data || [];
    if (!list.length) { if (box) box.remove(); return; }
    const sum = (k) => list.reduce((a, o) => a + Number(o[k] || 0), 0);
    const pend = list.filter((o) => !o.rider_settled_at).reduce((a, o) => a + Number(o.rider_cod_collected || 0) - Number(o.rider_purchase_paid || 0) - Number(o.rider_earning || 0), 0);
    if (!box) {
      box = document.createElement('section');
      box.id = 'qdRiderToday';
      box.setAttribute('aria-label', 'আজকের কুইক ডেলিভারি হিসাব');
      anchorEl.parentNode.insertBefore(box, anchorEl);
    }
    box.style.cssText = 'margin:12px 0;padding:16px;border-radius:20px;background:linear-gradient(135deg,#1B2A4A,#2C4372);color:#fff;font-family:inherit;';
    const cell = (label, val) => '<div style="background:rgba(255,255,255,.1);border-radius:14px;padding:10px 12px;"><small style="display:block;font-size:0.72rem;font-weight:600;opacity:.8;">' + label + '</small><b style="font-size:1.15rem;">' + TK(val) + '</b></div>';
    box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><i class="fas fa-bolt" style="color:#FFB48F;"></i><b style="flex:1;font-size:1rem;">আজকের হিসাব · কুইক ডেলিভারি</b><span style="font-size:0.78rem;opacity:.8;">' + BN(list.length) + 'টি অর্ডার</span></div>'
      + '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;">' + cell('COD আদায়', sum('rider_cod_collected')) + cell('দোকানে দিয়েছি', sum('rider_purchase_paid')) + cell('আমার আয়', sum('rider_earning')) + '</div>'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding:12px 14px;border-radius:14px;background:' + (pend > 0 ? '#FF6B35' : '#1F8A5B') + ';"><span style="font-weight:700;">' + (pend > 0 ? 'অফিসে জমা দিতে হবে' : pend < 0 ? 'অফিস আপনাকে দেবে' : 'হিসাব শেষ ✓') + '</span><b style="font-size:1.3rem;">' + TK(Math.abs(pend)) + '</b></div>';
  } catch (_) { /* কার্ড না এলেও চলবে */ }
}
