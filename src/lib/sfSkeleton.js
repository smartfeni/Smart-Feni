// ============================================================
// Smart Feni — শেয়ার্ড স্কেলেটন লোডিং
// স্টাইল: src/styles/sf-skeleton.css (BaseLayout-এ ইমপোর্ট করা)
//
// BaseLayout থেকে initSFSkeleton() একবার কল হয়, তারপর সব পেজে:
//
//   window.SFSkeleton.html('listing', 4)
//       -> innerHTML-এ বসানোর মতো স্কেলেটন HTML স্ট্রিং
//
//   const done = window.SFSkeleton.fill(el, 'listing', 4)
//       -> ১৫০ms পরেও ডাটা না এলে el-এ স্কেলেটন বসায় (দ্রুত এলে ঝলক নেই)।
//          এর মধ্যে el-এর কনটেন্ট বদলে গেলে স্কেলেটন বসায় না (ডাটা মুছবে না)।
//          ডাটা বসানোর পর done() কল করুন (না করলেও কনটেন্ট বদলালে aria-busy নিজে সরে)।
//
// প্রিসেট: card, listing, row, donor, doctor, order, profile, grid, table
// সার্ভার-রেন্ডার: <Skeleton preset="listing" count={4} />  (src/components/ui/Skeleton.astro)
// ============================================================

const SHOW_DELAY_MS = 150;

const L = (w = '', size = '') => '<span class="sk sk-line' + (size ? ' sk-' + size : '') + (w ? ' sk-w-' + w : '') + '"></span>';
const C = (px) => '<span class="sk sk-circle" style="width:' + px + 'px;height:' + px + 'px"></span>';
const P = (w) => '<span class="sk sk-pill" style="width:' + w + 'px"></span>';

const PRESETS = {
  // ছবি উপরে, নিচে শিরোনাম + বিবরণ (মার্কেট/গ্যালারি/সার্ভিস কার্ড)
  card: () =>
    '<div class="sk-card"><span class="sk sk-img"></span>' + L('90', 'lg') + L('50') + '</div>',

  // বাঁয়ে ছোট ছবি, ডানে ৩ লাইন (লিস্টিং/শপ)
  listing: () =>
    '<div class="sk-card sk-row"><span class="sk" style="width:84px;height:84px;border-radius:12px;flex-shrink:0"></span>' +
    '<div class="sk-col">' + L('90', 'lg') + L('70') + L('35') + '</div></div>',

  // গোল আইকন + ২ লাইন (নোটিফিকেশন/সাধারণ তালিকা)
  row: () =>
    '<div class="sk-card sk-row">' + C(40) + '<div class="sk-col">' + L('70') + L('50', 'sm') + '</div></div>',

  // গোল ছবি + নাম + ছোট লাইন + ডানে বাটন (রক্তদাতা/সদস্য)
  donor: () =>
    '<div class="sk-card sk-row">' + C(44) + '<div class="sk-col">' + L('70') + L('35', 'sm') + '</div>' + P(72) + '</div>',

  // বড় গোল ছবি + ৩ লাইন + নিচে বাটন (ডাক্তার/ক্লিনিক)
  doctor: () =>
    '<div class="sk-card"><div class="sk-row">' + C(56) + '<div class="sk-col">' + L('70', 'lg') + L('90') + L('50', 'sm') + '</div></div>' +
    '<div class="sk-foot">' + L('35') + P(96) + '</div></div>',

  // অর্ডার কার্ড: হেডার + ২ লাইন + নিচে স্ট্যাটাস/বাটন
  order: () =>
    '<div class="sk-card"><div class="sk-foot" style="margin-top:0">' + L('50', 'lg') + P(64) + '</div>' +
    '<div style="margin-top:12px">' + L('90') + L('70') + '</div>' +
    '<div class="sk-foot">' + L('35') + P(96) + '</div></div>',

  // প্রোফাইল হেডার
  profile: () =>
    '<div class="sk-card sk-center">' + C(80) + '<div style="width:100%;margin-top:12px">' + L('50', 'lg') + L('35') + '</div></div>',

  // গ্রিড টাইল (ক্যাটাগরি/ছবি)
  grid: () =>
    '<div class="sk-card" style="padding:10px"><span class="sk sk-img" style="aspect-ratio:1/1"></span>' + L('70', 'sm') + '</div>',

  // অ্যাডমিন টেবিলের সারি (count = সারির সংখ্যা)
  table: () =>
    '<div class="sk-trow">' + L('90') + L('70') + L('50') + P(72) + '</div>',
};

function clampCount(n) {
  const x = Number(n);
  return Number.isFinite(x) ? Math.min(Math.max(Math.round(x), 1), 30) : 3;
}

// শুধু স্ট্রিং বানায়, window লাগে না — তাই Astro সার্ভার-রেন্ডারেও চলে
export function skeletonMarkup(preset = 'card', count = 3, label = 'লোড হচ্ছে') {
  const make = PRESETS[preset] || PRESETS.card;
  const n = clampCount(count);
  let items = '';
  for (let i = 0; i < n; i++) items += make();
  const status = '<span class="sk-sr" role="status">' + String(label).replace(/[&<>"']/g, '') + '</span>';
  if (preset === 'table') {
    return '<div class="sk-table" data-sk="table">' + status + '<div aria-hidden="true">' + items + '</div></div>';
  }
  const cls = 'sk-list' + (preset === 'card' || preset === 'grid' ? ' sk-grid' : '');
  return '<div class="' + cls + '" data-sk="' + preset + '">' + status + '<div style="display:contents" aria-hidden="true">' + items + '</div></div>';
}

let seq = 0;

export function fillSkeleton(el, preset = 'card', count = 3, opts = {}) {
  if (!el) return () => {};
  const id = String(++seq);
  const snapshot = el.innerHTML;
  const delay = typeof opts.delay === 'number' ? opts.delay : SHOW_DELAY_MS;
  let observer = null;
  let finished = false;

  el.dataset.skToken = id;
  el.setAttribute('aria-busy', 'true');

  function done() {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (observer) observer.disconnect();
    if (el.dataset.skToken === id) {
      delete el.dataset.skToken;
      el.removeAttribute('aria-busy');
    }
  }

  const timer = setTimeout(() => {
    // এর মধ্যে ডাটা বসে গেছে বা অন্য fill শুরু হয়েছে -> কিছু করবে না
    if (finished || el.dataset.skToken !== id || el.innerHTML !== snapshot) {
      if (el.innerHTML !== snapshot) done();
      return;
    }
    el.innerHTML = skeletonMarkup(preset, count, opts.label);
    // পেজ ডাটা বসালে (স্কেলেটন সরে গেলে) aria-busy নিজে থেকে সরবে
    observer = new MutationObserver(() => {
      if (!el.querySelector(':scope > [data-sk]')) done();
    });
    observer.observe(el, { childList: true });
  }, delay);

  return done;
}

export function initSFSkeleton() {
  if (typeof window === 'undefined' || window.SFSkeleton) return;
  window.SFSkeleton = { html: skeletonMarkup, fill: fillSkeleton };
}
