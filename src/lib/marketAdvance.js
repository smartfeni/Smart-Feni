// path: src/lib/marketAdvance.js
// ============================================================
// কুইক ডেলিভারি: রাইডার নিজে অগ্রিম যাচাই করে (delivery-hero ও pro/hero/delivery দুই জায়গায় একই)।
// কাস্টমার রাইডারের বিকাশে টাকা পাঠালে (delivery_payments.receiver = 'rider') চলমান কার্ডে
// [data-adv-verify] বক্সে পেমেন্টের তথ্য + "পেয়েছি" / "মেলেনি" বাটন আসে।
// RPC: rider_pending_advance (পড়া), rider_verify_advance (যাচাই; admin_verify_advance-এর মতোই ফল)।
// অফিস মোডে (market_advance_receiver = admin) বা অফিসের নম্বরে পাঠানো পেমেন্টে কিছুই দেখায় না।
// ============================================================
const BN = (n) => String(n).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const TK = (n) => '৳' + BN(Math.round(Number(n) || 0));

export async function mountAdvanceVerify(card, req, supabase, onDone) {
  const slot = card.querySelector('[data-adv-verify]');
  if (!slot || !req.is_market || req.advance_verified) return;
  let p = null;
  try {
    const { data } = await supabase.rpc('rider_pending_advance', { p_request_id: req.id });
    p = data;
  } catch (_) { return; }
  if (!p || !p.id) return;
  const box = document.createElement('div');
  box.style.cssText = 'margin-top:10px;padding:14px;border-radius:16px;background:#fff;border:2px solid #E2136E;color:#1B2A4A;';
  const row = (k, v) => '<div style="display:flex;justify-content:space-between;gap:10px;padding:4px 0;font-weight:600;color:#33415C;"><span>' + k + '</span><b style="color:#1B2A4A;text-align:right;"></b></div>';
  box.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><img src="/market/pay/bkash.webp" alt="" aria-hidden="true" style="width:30px;height:30px;object-fit:contain;" /><b style="flex:1;font-size:1rem;">অগ্রিম এসেছে, মিলিয়ে নিন</b></div>'
    + row('কাস্টমার বলছেন পাঠিয়েছেন') + row('TrxID') + row('পাঠানো নম্বরের শেষ ৪ ডিজিট') + row('ধরন')
    + '<p style="margin:8px 0;font-size:0.84rem;color:#5A6B85;font-weight:600;line-height:1.5;">আপনার বিকাশ অ্যাপে টাকা এসেছে কিনা দেখুন। যত টাকা পেয়েছেন সেটাই লিখুন।</p>'
    + '<label style="display:block;font-size:0.84rem;font-weight:700;color:#4A5568;">কত টাকা পেয়েছেন <i class="required-mark">*</i><input data-adv-amt type="number" inputmode="numeric" min="1" required style="display:block;width:100%;margin-top:4px;height:48px;border:1.5px solid #E2E7EF;border-radius:12px;padding:0 12px;font-size:17px;font-family:inherit;box-sizing:border-box;" /></label>'
    + '<p data-adv-err style="display:none;margin:8px 0 0;color:#B42318;font-weight:700;font-size:0.86rem;"></p>'
    + '<div style="display:flex;gap:8px;margin-top:10px;">'
    + '<button type="button" data-adv-ok style="flex:2;min-height:52px;border:0;border-radius:14px;background:#16A34A;color:#fff;font-weight:800;font-size:1rem;font-family:inherit;cursor:pointer;">✓ পেয়েছি</button>'
    + '<button type="button" data-adv-no style="flex:1;min-height:52px;border:1.5px solid #B42318;border-radius:14px;background:#fff;color:#B42318;font-weight:800;font-family:inherit;cursor:pointer;">মেলেনি</button></div>';
  const vals = [TK(p.amount), p.trx || '—', p.last4 ? BN(p.last4) : '—', p.mode === 'full' ? 'পুরো টাকা (' + TK(p.full_total) + ')' : 'শুধু চার্জ (' + TK(p.fare) + ')'];
  box.querySelectorAll('b[style*="text-align:right"]').forEach((b, i) => { b.textContent = vals[i]; });
  const amt = box.querySelector('[data-adv-amt]');
  amt.value = String(Math.round(Number(p.amount) || 0));
  const err = (m) => { const e = box.querySelector('[data-adv-err]'); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
  const ok = box.querySelector('[data-adv-ok]'), no = box.querySelector('[data-adv-no]');
  const run = async (isOk) => {
    const a = Number(amt.value);
    if (isOk && !(a > 0)) { err('কত টাকা পেয়েছেন লিখুন'); return; }
    if (!isOk && !window.confirm('নিশ্চিত, টাকা আপনার বিকাশে আসেনি? কাস্টমারকে আবার জমা দিতে বলা হবে।')) return;
    if (isOk && a < Number(p.amount) && !window.confirm('কাস্টমার ' + TK(p.amount) + ' বলছেন, আপনি ' + TK(a) + ' লিখেছেন। এটাই ঠিক?')) return;
    err(''); ok.disabled = no.disabled = true;
    const old = (isOk ? ok : no).textContent; (isOk ? ok : no).textContent = 'হচ্ছে…';
    try {
      const { error } = await supabase.rpc('rider_verify_advance', { p_payment_id: p.id, p_ok: isOk, p_amount: isOk ? a : null, p_note: null });
      if (error) { err(error.message || 'হয়নি'); ok.disabled = no.disabled = false; (isOk ? ok : no).textContent = old; return; }
      if (window.showToast) window.showToast(isOk ? 'অগ্রিম যাচাই হয়েছে, এখন কিনতে যান' : 'কাস্টমারকে জানানো হয়েছে', isOk ? 'success' : 'info');
      if (typeof onDone === 'function') onDone();
    } catch (_) {
      err('ইন্টারনেটে সমস্যা, আবার চেষ্টা করুন'); ok.disabled = no.disabled = false; (isOk ? ok : no).textContent = old;
    }
  };
  ok.addEventListener('click', () => run(true));
  no.addEventListener('click', () => run(false));
  slot.textContent = '';
  slot.appendChild(box);
}
