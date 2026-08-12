// path: src/lib/locationSort.js
// ============================================================
// শেয়ারড ইউটিলিটি: ইউজারের সেভ করা উপজেলা অনুযায়ী কার্ড re-order
// যেকোনো লিস্টিং পেজে (blood, recycle, housing, car-rental ইত্যাদি)
// ব্যবহার করা যাবে — শুধু গ্রিড এলিমেন্ট আর data attribute নাম দিলেই হবে
//
// আপডেট (নতুন — mode প্যারামিটার): দুই ধরনের কনজিউমার আছে এই ফাইলের —
// ১. ব্লাড ডোনার লিস্ট (blood/[group].astro) — ফেয়ারনেসের জন্য
//    ইচ্ছাকৃতভাবে র‍্যান্ডম শাফল দরকার (একই ডোনার সবসময় টপে থাকবে না)
// ২. বাকি সব লিস্টিং ক্যাটাগরি পেজ (housing, repair, job...) — এখানে
//    "লেটেস্ট পোস্ট আগে" থাকা জরুরি, র‍্যান্ডম শাফল করলে সেটা হারিয়ে যায়
// তাই mode='shuffle' (ডিফল্ট, ব্যাকওয়ার্ড-কম্প্যাটিবল — ব্লাড ডোনার
// পেজের কল-সাইট অপরিবর্তিত রাখা যায়) আর mode='latest' (নতুন, লিস্টিং
// ক্যাটাগরি পেজগুলো এক্সপ্লিসিটলি এটা পাস করবে) — দুটোই সাপোর্ট করে।
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
 *
 * mode='shuffle' (ডিফল্ট): প্রতিটা গ্রুপের ভেতরে র‍্যান্ডম শাফল —
 *   ফেয়ারনেসের জন্য (ব্লাড ডোনার লিস্টে ব্যবহৃত, যাতে একই ডোনার
 *   সবসময় টপে না থাকে)।
 * mode='latest': শাফল না করে সার্ভার থেকে আসা অর্ডারটাই (লেটেস্ট
 *   পোস্ট আগে — কোয়েরিতে created_at DESC) প্রতিটা গ্রুপের ভেতরে অক্ষত
 *   রাখা হয়। ফলাফল: নিজের উপজেলার সবচেয়ে নতুন পোস্ট সবার আগে, তারপর
 *   নিজের উপজেলার বাকিগুলো (নতুন→পুরনো), তারপর বাকি উপজেলার পোস্ট
 *   (নতুন→পুরনো)।
 *
 * @param {HTMLElement|null} grid - কার্ডগুলো যে কন্টেইনারের ভেতরে আছে
 * @param {string} dataAttr - প্রতিটা কার্ডের dataset key, যেখানে বাংলা
 *                             উপজেলার নাম বসানো আছে (যেমন data-upazila-name
 *                             হলে dataset key হবে 'upazilaName')
 * @param {'shuffle'|'latest'} mode
 */
export function reorderByUserLocation(grid, dataAttr = 'upazilaName', mode = 'shuffle') {
  if (!grid) return;

  const savedSlug = localStorage.getItem('smartfeni_upazila');
  const savedName = savedSlug ? UPAZILA_SLUG_TO_NAME[savedSlug] : null;

  const cardArray = Array.from(grid.children);
  const arrange = (arr) => (mode === 'latest' ? arr : shuffle(arr));

  if (!savedName) {
    if (mode === 'latest') return; // সার্ভারের লেটেস্ট-ফার্স্ট অর্ডারই বহাল থাকবে
    shuffle(cardArray).forEach((card) => grid.appendChild(card));
    return;
  }

  const matching = cardArray.filter((c) => c.dataset[dataAttr] === savedName);
  const rest = cardArray.filter((c) => c.dataset[dataAttr] !== savedName);

  if (matching.length === 0) {
    if (mode === 'latest') return;
    shuffle(cardArray).forEach((card) => grid.appendChild(card));
    return;
  }

  [...arrange(matching), ...arrange(rest)].forEach((card) => grid.appendChild(card));
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
 * @param {'shuffle'|'latest'} mode
 */
export function initLocationReorder(grid, dataAttr = 'upazilaName', mode = 'shuffle') {
  if (!grid) return;

  reorderByUserLocation(grid, dataAttr, mode);

  window.addEventListener('smartfeni:upazila-changed', () => {
    reorderByUserLocation(grid, dataAttr, mode);
  });
}