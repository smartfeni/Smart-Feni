// ============================================================
// সেন্ড মানি খরচের টিক বক্স (নতুন অ্যাপ /console)
// কোম্পানি টাকা পাঠালে (রাইডার পেমেন্ট/অগ্রিম, রেফার উইথড্র, স্ক্রেচ কার্ড পুরস্কার)
// টিক দিলে কোম্পানির হিসাবে আলাদা খরচ "সেন্ড মানি খরচ" ওঠে।
// RPC: admin_hisab_send_fee(p_source, p_id, p_amount) — পেমেন্ট সম্পন্ন হওয়ার পর, একই পেমেন্টে একবারই।
//   p_source: 'rider_wallet' | 'referral_withdraw' | 'scratch_card'
// ডিফল্ট ৳৫, ঘরে বদলানো যায় (কখনো ১০ হয়)।
// ============================================================
import { supabase } from './supabase.js';

const DEFAULT_FEE = 5;

function injectStyle() {
  if (document.getElementById('sfFeeStyle')) return;
  const st = document.createElement('style');
  st.id = 'sfFeeStyle';
  st.textContent = `
    .sf-fee { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; width: 100%; padding: 8px 10px; border-radius: 12px; background: #FFF4EC; border: 1px solid #FFE1CF; font-size: .86rem; color: #1B2A4A; }
    .sf-fee label { display: flex; align-items: center; gap: 6px; font-weight: 700; cursor: pointer; }
    .sf-fee input[type=checkbox] { width: 18px; height: 18px; accent-color: #FF6B35; }
    .sf-fee .sf-fee-amt { display: flex; align-items: center; gap: 4px; margin-left: auto; }
    .sf-fee .sf-fee-amt input { width: 70px; padding: 6px 8px; border: 1px solid #E2E8F0; border-radius: 10px; font: inherit; text-align: right; background: #fff; }
    .sf-fee .sf-fee-amt input:disabled { opacity: .5; }
    .sf-fee small { flex-basis: 100%; color: #64748B; font-size: .74rem; }
  `;
  document.head.appendChild(st);
}

/** টিক বক্স + টাকার ঘর। checked: শুরুতে টিক থাকবে কিনা (বিকাশ/নগদ পেমেন্টে true) */
export function sendFeeField(checked = true) {
  injectStyle();
  const box = document.createElement('div');
  box.className = 'sf-fee';
  const lab = document.createElement('label');
  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!checked;
  lab.append(cb, document.createTextNode('সেন্ড মানি খরচ'));
  const amtWrap = document.createElement('span');
  amtWrap.className = 'sf-fee-amt';
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.inputMode = 'decimal';
  inp.min = '1';
  inp.max = '500';
  inp.step = '1';
  inp.value = String(DEFAULT_FEE);
  inp.setAttribute('aria-label', 'সেন্ড মানি খরচ (টাকা)');
  inp.disabled = !cb.checked;
  amtWrap.append(document.createTextNode('৳'), inp);
  const hint = document.createElement('small');
  hint.textContent = 'টিক দিলে কোম্পানির হিসাবে আলাদা খরচ হিসেবে উঠবে';
  box.append(lab, amtWrap, hint);
  cb.addEventListener('change', () => { inp.disabled = !cb.checked; });

  return {
    el: box,
    /** null = টিক নেই; NaN = ভুল পরিমাণ; নাহলে টাকা */
    amount() {
      if (!cb.checked) return null;
      const v = Number(inp.value);
      return v > 0 && v <= 500 ? Math.round(v * 100) / 100 : NaN;
    },
    focus() { inp.focus(); },
  };
}

/** পেমেন্ট সফল হওয়ার পর ডাকো। amount null হলে কিছু করে না। ফল: true/false */
export async function addSendFee(source, id, amount) {
  if (amount == null) return true;
  const { error } = await supabase.rpc('admin_hisab_send_fee', { p_source: source, p_id: id, p_amount: amount });
  if (error) {
    const msg = error.message && /[ঀ-৿]/.test(error.message) ? error.message : 'আবার চেষ্টা করুন';
    window.showToast?.('পেমেন্ট হয়েছে, কিন্তু সেন্ড মানি খরচ হিসাবে ওঠেনি: ' + msg, 'warning');
    return false;
  }
  return true;
}
