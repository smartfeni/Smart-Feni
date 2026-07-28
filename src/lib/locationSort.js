// ============================================================
// শেয়ারড ইউটিলিটি: ইউজারের সেভ করা উপজেলা অনুযায়ী কার্ড re-order
// যেকোনো লিস্টিং পেজে (blood, recycle, housing, car-rental ইত্যাদি)
// ব্যবহার করা যাবে — শুধু গ্রিড এলিমেন্ট আর data attribute নাম দিলেই হবে
// ============================================================

// LocationSelector.astro-র slug আইডি ↔ বাংলা উপজেলার নাম ম্যাপিং
export const UPAZILA_SLUG_TO_NAME = {
  'feni-sadar': 'ফেনী সদর',
  'chhagalnaiya': 'ছাগলনাইয়া',
  'daganbhuiyan': 'দাগনভূঞা',
  'parshuram': 'পরশুরাম',
  'fulgazi': 'ফুলগাজী',
  'sonagazi': 'সোনাগাজী',
};

/**
 * Fisher-Yates শাফল — একটা কপি অ্যারে রিটার্ন করে, মূল অ্যারে বদলায় না
 */
function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * grid-এর ভেতরের সরাসরি চাইল্ড কার্ডগুলোকে ইউজারের সেভ করা উপজেলা
 * অনুযায়ী re-order করে (ম্যাচ করা কার্ড আগে, বাকিরা পরে)।
 * প্রতিটা গ্রুপের (matching / rest) ভেতরে shuffle করা হয় — যাতে
 * সবসময় একই কার্ড টপে না থাকে (fairness), কোনো ব্যাজ/হাইলাইট দেখায় না।
 *
 * @param {HTMLElement|null} grid - কার্ডগুলো যে কন্টেইনারের ভেতরে আছে
 * @param {string} dataAttr - প্রতিটা কার্ডের dataset key, যেখানে বাংলা
 *                             উপজেলার নাম বসানো আছে (যেমন data-upazila-name
 *                             হলে dataset key হবে 'upazilaName')
 */
export function reorderByUserLocation(grid, dataAttr = 'upazilaName') {
  if (!grid) return;

  const savedSlug = localStorage.getItem('smartfeni_upazila');
  const savedName = savedSlug ? UPAZILA_SLUG_TO_NAME[savedSlug] : null;

  const cardArray = Array.from(grid.children);

  if (!savedName) {
    // কোনো উপজেলা সেভ করা নাই — শুধু fairness shuffle করে দেখাবে
    shuffle(cardArray).forEach((card) => grid.appendChild(card));
    return;
  }

  const matching = cardArray.filter((c) => c.dataset[dataAttr] === savedName);
  const rest = cardArray.filter((c) => c.dataset[dataAttr] !== savedName);

  if (matching.length === 0) {
    shuffle(cardArray).forEach((card) => grid.appendChild(card));
    return;
  }

  [...shuffle(matching), ...shuffle(rest)].forEach((card) => grid.appendChild(card));
}

/**
 * reorderByUserLocation-এর "লাইভ" ভার্সন — পেজ লোড হওয়ার সাথে সাথে একবার
 * sort করে, এবং ইউজার পেজের ভেতরে থাকা অবস্থায় উপজেলা বদলালে (LocationSelector
 * থেকে 'smartfeni:upazila-changed' ইভেন্ট ডিসপ্যাচ হলে) আবার নতুন করে sort করে।
 *
 * নোট: 'smartfeni:upazila-changed' ইভেন্টটা LocationSelector.astro থেকে
 * ডিসপ্যাচ হওয়ার কথা। সেই ফাইলে এখনো এই ডিসপ্যাচ যোগ করা না থাকলে শুধু
 * প্রথমবার লোডের sort-টাই কাজ করবে, লাইভ re-sort কাজ করবে না।
 *
 * @param {HTMLElement|null} grid
 * @param {string} dataAttr
 */
export function initLocationReorder(grid, dataAttr = 'upazilaName') {
  if (!grid) return;

  reorderByUserLocation(grid, dataAttr);

  window.addEventListener('smartfeni:upazila-changed', () => {
    reorderByUserLocation(grid, dataAttr);
  });
}