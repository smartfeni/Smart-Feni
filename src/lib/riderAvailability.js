// path: src/lib/riderAvailability.js
// ============================================================
// শেয়ার্ড হেল্পার: কোন উপজেলায় অনলাইন রাইডার আছে কিনা — লাইভ চেক
//
// DeliveryHeroCard ও RideHeroCard দুটোই এটা ব্যবহার করে।
// অনলাইন মানে: delivery_riders-এ verification_status = 'approved'
// এবং is_active = true (রাইডার ড্যাশবোর্ডের অনলাইন টগল)।
//
// স্টেট:
//   'unknown'       — চেক করা যায়নি (নেটওয়ার্ক সমস্যা) → ব্লক করে না,
//                     সার্ভার (create-request API) শেষ সিদ্ধান্ত নেয়
//   'none-district' — পুরো ফেনীতে কেউ অনলাইনে নেই → ফর্ম লুকিয়ে নোটিশ
//   'none-upazila'  — সিলেক্ট করা উপজেলায় কেউ নেই → নোটিশ + সাবমিট বন্ধ
//   'none-vehicle'  — এই উপজেলায় আছে, কিন্তু সিলেক্ট করা বাহনের নেই
//   'ok'            — অর্ডার করা যাবে
//
// প্রতি ১৫ সেকেন্ডে অটো রিফ্রেশ (ট্যাব দৃশ্যমান থাকলে) — রাইডার
// অনলাইন হলে নোটিশ নিজে থেকেই সরে ফর্ম ফিরে আসবে।
// ============================================================

import { supabase } from './supabase.js';

const POLL_MS = 15000;

export async function fetchOnlineRiders(category) {
  const offersColumn = category === 'ride' ? 'offers_ride' : 'offers_delivery';

  const { data, error } = await supabase
    .from('delivery_riders')
    .select('id, upazila, vehicle_type')
    .eq('verification_status', 'approved')
    .eq('is_active', true)
    .eq(offersColumn, true);

  if (error) return null;
  return data || [];
}

export function evaluateAvailability(riders, upazila, vehicleType) {
  if (riders === null) return 'unknown';
  if (riders.length === 0) return 'none-district';
  if (!upazila) return 'ok';

  const inUpazila = riders.filter((r) => r.upazila === upazila);
  if (inUpazila.length === 0) return 'none-upazila';

  if (vehicleType && vehicleType !== 'any') {
    const hasVehicle = inUpazila.some((r) => r.vehicle_type === vehicleType);
    if (!hasVehicle) return 'none-vehicle';
  }

  return 'ok';
}

const SUPPORT_LINE = 'জরুরি প্রয়োজনে যোগাযোগ করুন।';

function getNoticeCopy(state, upazila) {
  if (state === 'none-vehicle') {
    return {
      title: `${upazila}-এ এই বাহনের কোনো রাইডার সক্রিয় নেই`,
      text: `"যেকোনো" বেছে নিন, অথবা কিছুক্ষণ পর চেষ্টা করুন। ${SUPPORT_LINE}`,
    };
  }

  if (state === 'none-upazila') {
    return {
      title: `দুঃখিত, ${upazila}-এ এই মুহূর্তে কোনো রাইডার সক্রিয় নেই`,
      text: `অনুগ্রহ করে কিছুক্ষণ পর চেষ্টা করুন। ${SUPPORT_LINE}`,
    };
  }

  return {
    title: 'দুঃখিত, এই মুহূর্তে কোনো রাইডার সক্রিয় নেই',
    text: `অনুগ্রহ করে কিছুক্ষণ পর চেষ্টা করুন। ${SUPPORT_LINE}`,
  };
}

/**
 * কার্ডের ফর্মের সাথে অ্যাভেইলেবিলিটি চেক জুড়ে দেয়।
 *
 * @param {object} opts
 * @param {'delivery'|'ride'} opts.category
 * @param {HTMLElement} opts.root          — NoRiderNotice-এর root এলিমেন্ট
 * @param {HTMLFormElement} opts.form
 * @param {HTMLSelectElement} opts.upazilaSelect
 * @param {HTMLInputElement} opts.vehicleInput
 * @param {NodeListOf<Element>} opts.vehicleButtons
 * @param {HTMLButtonElement} opts.submitBtn
 * @returns {{ refresh: () => Promise<void>, apply: () => void }}
 */
export function initRiderAvailability({
  category,
  root,
  form,
  upazilaSelect,
  vehicleInput,
  vehicleButtons,
  submitBtn,
}) {
  let riders = null;

  const titleEl = root?.querySelector('[data-notice-title]');
  const textEl = root?.querySelector('[data-notice-text]');
  const waEl = root?.querySelector('[data-notice-wa]');
  const waNumber = root?.dataset.waNumber || '8801816355833';
  const waLabel = root?.dataset.waLabel || 'ডেলিভারি';

  function apply() {
    if (!root || !form) return;

    // রিকোয়েস্ট সফলভাবে পাঠানো হয়ে গেলে আর কিছু বদলাবে না
    if (form.dataset.done === '1') {
      root.hidden = true;
      return;
    }

    const upazila = upazilaSelect?.value || '';
    const state = evaluateAvailability(riders, upazila, vehicleInput?.value || 'any');
    const blocked = state.startsWith('none');

    root.hidden = !blocked;
    form.style.display = state === 'none-district' ? 'none' : '';

    if (blocked) {
      const copy = getNoticeCopy(state, upazila);
      if (titleEl) titleEl.textContent = copy.title;
      if (textEl) textEl.textContent = copy.text;

      if (waEl) {
        const place = upazila ? ` (${upazila})` : '';
        const msg = `আসসালামু আলাইকুম, স্মার্ট ফেনীতে জরুরি ${waLabel} সার্ভিস দরকার${place}।`;
        waEl.href = `https://wa.me/${waNumber}?text=${encodeURIComponent(msg)}`;
      }
    }

    // সাবমিট চলাকালীন বাটনে হাত দেওয়া হবে না
    if (submitBtn && submitBtn.dataset.busy !== '1') {
      submitBtn.disabled = blocked;
    }
  }

  async function refresh() {
    riders = await fetchOnlineRiders(category);
    apply();
  }

  upazilaSelect?.addEventListener('change', apply);
  vehicleButtons?.forEach((btn) => btn.addEventListener('click', apply));

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refresh();
  });

  setInterval(() => {
    if (!document.hidden) refresh();
  }, POLL_MS);

  refresh();

  return { refresh, apply };
}