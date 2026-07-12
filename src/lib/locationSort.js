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
 * grid-এর ভেতরের সরাসরি চাইল্ড কার্ডগুলোকে ইউজারের সেভ করা উপজেলা
 * অনুযায়ী re-order করে (ম্যাচ করা কার্ড আগে, বাকিরা পরে)।
 * কোনো ব্যাজ/হাইলাইট দেখায় না — শুধু নিঃশব্দে ক্রম বদলায়।
 *
 * @param {HTMLElement|null} grid - কার্ডগুলো যে কন্টেইনারের ভেতরে আছে
 * @param {string} dataAttr - প্রতিটা কার্ডের dataset key, যেখানে বাংলা
 *                             উপজেলার নাম বসানো আছে (যেমন data-upazila-name
 *                             হলে dataset key হবে 'upazilaName')
 */
export function reorderByUserLocation(grid, dataAttr = 'upazilaName') {
  if (!grid) return;

  const savedSlug = localStorage.getItem('smartfeni_upazila');
  if (!savedSlug) return;

  const savedName = UPAZILA_SLUG_TO_NAME[savedSlug];
  if (!savedName) return;

  const cardArray = Array.from(grid.children);
  const matching = cardArray.filter((c) => c.dataset[dataAttr] === savedName);
  const rest = cardArray.filter((c) => c.dataset[dataAttr] !== savedName);

  if (matching.length === 0) return;

  [...matching, ...rest].forEach((card) => grid.appendChild(card));
}