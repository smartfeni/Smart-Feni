// ============================================================
// শেয়ারড লজিক: ReportModal.astro এর open/close/submit হ্যান্ডলিং
// ব্যবহার (পেজের <script>-এ):
//   import { initReportModal } from '../../lib/reportModal.js';
//
//   const report = initReportModal({
//     reasons: [
//       { value: 'unavailable', label: 'এভেইলেবল না / প্রবাসে' },
//       { value: 'behavior', label: 'আচরণ খারাপ' },
//       { value: 'wrong_info', label: 'ভুল তথ্য' },
//       { value: 'other', label: 'অন্যান্য' },
//     ],
//   });
//
//   // ফ্ল্যাগ আইকনে ক্লিক করলে:
//   report.open('blood_profile', donorId);
// ============================================================

import { submitReport } from './contentEngagement.js';

const HELPLINE_NUMBER = '01xxxxxxxxx'; // TODO: রিয়েল হেল্পলাইন নাম্বার বসাতে হবে

export function initReportModal({ reasons = [] }) {
  const overlay = document.getElementById('reportOverlay');
  const closeBtn = document.getElementById('reportClose');
  const reasonsWrap = document.getElementById('reportReasons');
  const detailsInput = document.getElementById('reportDetailsInput');
  const feedbackEl = document.getElementById('reportFeedback');
  const submitBtn = document.getElementById('reportSubmitBtn');

  if (!overlay) return { open: () => {} };

  let currentTargetType = null;
  let currentTargetId = null;
  let selectedReason = null;

  // ===== রিজন অপশন রেন্ডার =====
  reasonsWrap.innerHTML = reasons
    .map(
      (r) => `
      <button type="button" class="report-reason-option" data-value="${r.value}">
        <span class="radio-dot"></span>
        <span>${r.label}</span>
      </button>
    `
    )
    .join('');

  reasonsWrap.querySelectorAll('.report-reason-option').forEach((btn) => {
    btn.addEventListener('click', () => {
      reasonsWrap.querySelectorAll('.report-reason-option').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedReason = btn.dataset.value;
      hideFeedback();
    });
  });

  function resetForm() {
    selectedReason = null;
    detailsInput.value = '';
    reasonsWrap.querySelectorAll('.report-reason-option').forEach((b) => b.classList.remove('selected'));
    hideFeedback();
    submitBtn.disabled = false;
    submitBtn.textContent = 'জমা দিন';
  }

  function showFeedback(message, type = 'error') {
    feedbackEl.textContent = message;
    feedbackEl.className = `report-feedback ${type}`;
  }

  function hideFeedback() {
    feedbackEl.textContent = '';
    feedbackEl.className = 'report-feedback';
  }

  function open(targetType, targetId) {
    currentTargetType = targetType;
    currentTargetId = targetId;
    resetForm();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function close() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  closeBtn?.addEventListener('click', close);
  overlay?.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  submitBtn?.addEventListener('click', async () => {
    if (!selectedReason) {
      showFeedback('একটা কারণ বেছে নিন');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'পাঠানো হচ্ছে...';
    hideFeedback();

    const result = await submitReport(
      currentTargetType,
      currentTargetId,
      selectedReason,
      detailsInput.value.trim() || null
    );

    if (result.success) {
      showFeedback('ধন্যবাদ, আপনার অভিযোগ জমা হয়েছে।', 'success');
      setTimeout(close, 1500);
    } else if (result.error === 'already_reported') {
      showFeedback(
        `আপনি ইতিমধ্যে এই লিস্টিং এর বিরুদ্ধে অভিযোগ করেছেন। অন্য কোনো সমস্যা থাকলে হেল্পলাইনে যোগাযোগ করুন: ${HELPLINE_NUMBER}`,
        'error'
      );
      submitBtn.disabled = false;
      submitBtn.textContent = 'জমা দিন';
    } else if (result.error === 'auth_required') {
      // requireAuth() ইতিমধ্যে auth-modal ইভেন্ট ছুড়ে দিয়েছে
      close();
    } else {
      showFeedback('একটা সমস্যা হয়েছে, আবার চেষ্টা করুন।', 'error');
      submitBtn.disabled = false;
      submitBtn.textContent = 'জমা দিন';
    }
  });

  return { open, close };
}