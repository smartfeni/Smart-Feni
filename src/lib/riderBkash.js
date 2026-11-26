// path: src/lib/riderBkash.js
// ============================================================
// রাইডারের বিকাশ নম্বর / ওয়ালেট কার্ড (delivery-hero ও pro/hero/delivery দুই জায়গায় একই)।
// কুইক ডেলিভারিতে অগ্রিম সরাসরি রাইডারের বিকাশে যায় (site_settings.market_advance_receiver = rider),
// তাই নম্বর না থাকলে কুইক ডেলিভারির অর্ডারে অফার/Accept করা যায় না (submit-offer, accept-best-price)।
// নম্বর থাকে আলাদা টেবিল rider_bkash-এ (শুধু নিজে ও স্টাফ পড়ে), সেভ হয় rider_set_bkash RPC দিয়ে।
// ============================================================
import { mountWalletCard, walletHref } from './riderWallet.js';

const BN = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);

// SF (২৬ নভে ২০২৬): এই জায়গায় এখন ওয়ালেট কার্ড; বিকাশ নম্বর যোগ/বদল ওয়ালেট পেজের ভেতরে।
// পুরনো ফর্ম (mountRiderBkashLegacy) রেখে দেওয়া, কোথাও ব্যবহার হয় না।
export async function mountRiderBkash(supabase, riderId, anchorEl) {
  return mountWalletCard(supabase, riderId, anchorEl);
}

export async function mountRiderBkashLegacy(supabase, riderId, anchorEl) {
  if (!riderId || !anchorEl || !anchorEl.parentNode) return;
  let box = document.getElementById('heroBkashCard');
  let num = '';
  try {
    const { data } = await supabase.from('rider_bkash').select('bkash_number').eq('rider_id', riderId).maybeSingle();
    num = (data && data.bkash_number) || '';
  } catch (_) { /* না পেলে ফাঁকা ধরে ফর্ম দেখাবে */ }
  if (!box) {
    box = document.createElement('section');
    box.id = 'heroBkashCard';
    box.setAttribute('aria-label', 'আমার বিকাশ নম্বর');
    anchorEl.parentNode.insertBefore(box, anchorEl);
  }
  window.SF_HERO_BKASH = num;
  if (num) {
    box.style.cssText = 'margin:12px 0;padding:12px 14px;border-radius:16px;background:#fff;border:1.5px solid #F3D9E6;display:flex;align-items:center;gap:10px;font-family:inherit;';
    box.innerHTML = '<img src="/market/pay/bkash.webp" alt="" aria-hidden="true" style="width:34px;height:34px;object-fit:contain;flex:none;" />'
      + '<div style="flex:1;min-width:0;"><small style="display:block;font-size:0.75rem;font-weight:700;color:#5A6B85;">আমার বিকাশ নম্বর (অগ্রিম এখানে আসবে)</small><b style="font-size:1.05rem;color:#1B2A4A;letter-spacing:0.5px;"></b></div>'
      + '<button type="button" data-bk-edit style="min-height:40px;padding:0 14px;border:1.5px solid #E2136E;border-radius:12px;background:#fff;color:#E2136E;font-weight:800;font-family:inherit;cursor:pointer;">বদলান</button>';
    box.querySelector('b').textContent = BN(num);
    box.querySelector('[data-bk-edit]').addEventListener('click', () => renderForm(supabase, riderId, box, num));
    return;
  }
  renderForm(supabase, riderId, box, '');
}

function renderForm(supabase, riderId, box, current) {
  box.style.cssText = 'margin:12px 0;padding:16px;border-radius:18px;background:#FFF1F7;border:2px solid #E2136E;font-family:inherit;';
  box.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;"><img src="/market/pay/bkash.webp" alt="" aria-hidden="true" style="width:36px;height:36px;object-fit:contain;flex:none;" /><b style="flex:1;color:#1B2A4A;font-size:1rem;">আপনার বিকাশ নম্বর দিন</b></div>'
    + '<p style="margin:0 0 10px;font-size:0.86rem;line-height:1.55;color:#4A5568;font-weight:600;">কুইক ডেলিভারির অগ্রিম টাকা কাস্টমার সরাসরি আপনার বিকাশে পাঠাবেন, আপনি মিলিয়ে নেবেন। নম্বর না দিলে কুইক ডেলিভারির অর্ডার নিতে পারবেন না।</p>'
    + '<form data-bk-form novalidate style="display:flex;gap:8px;">'
    + '<label style="flex:1;min-width:0;"><span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);">বিকাশ নম্বর <i class="required-mark">*</i></span><input data-bk-in type="tel" inputmode="numeric" maxlength="14" required placeholder="01XXXXXXXXX" style="width:100%;height:50px;border:1.5px solid #E2E7EF;border-radius:12px;padding:0 12px;font-size:17px;font-family:inherit;box-sizing:border-box;" /></label>'
    + '<button type="submit" data-bk-save style="flex:none;min-height:50px;padding:0 18px;border:0;border-radius:12px;background:#E2136E;color:#fff;font-weight:800;font-size:1rem;font-family:inherit;cursor:pointer;">সেভ</button>'
    + '</form><p data-bk-err style="display:none;margin:8px 0 0;color:#B42318;font-weight:700;font-size:0.86rem;"></p>';
  const input = box.querySelector('[data-bk-in]');
  input.value = current || '';
  const err = (m) => { const e = box.querySelector('[data-bk-err]'); e.textContent = m; e.style.display = m ? 'block' : 'none'; };
  box.querySelector('[data-bk-form]').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget;
    if (window.SFValidateForm && !window.SFValidateForm(form)) return;
    const v = input.value.trim();
    if (!v) { err('নম্বর লিখুন'); return; }
    err('');
    const btn = box.querySelector('[data-bk-save]');
    btn.disabled = true; const old = btn.textContent; btn.textContent = 'সেভ হচ্ছে…';
    try {
      const { error } = await supabase.rpc('rider_set_bkash', { p_number: v });
      if (error) { err(error.message || 'সেভ হয়নি'); btn.disabled = false; btn.textContent = old; return; }
      if (window.showToast) window.showToast('বিকাশ নম্বর সেভ হয়েছে', 'success');
      await mountRiderBkashLegacy(supabase, riderId, box);
    } catch (_) {
      err('ইন্টারনেটে সমস্যা, আবার চেষ্টা করুন'); btn.disabled = false; btn.textContent = old;
    }
  });
}

export function scrollToBkashCard() {
  // নম্বর না থাকলে সরাসরি ওয়ালেটের নম্বর-ফর্মে
  if (!window.SF_HERO_BKASH) { window.location.href = walletHref('bkash=1'); return; }
  const c = document.getElementById('heroBkashCard');
  if (c) { c.scrollIntoView({ behavior: 'smooth', block: 'center' }); const i = c.querySelector('input'); if (i) setTimeout(() => i.focus(), 400); }
}
