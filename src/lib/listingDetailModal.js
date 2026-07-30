// ============================================================
// শেয়ারড লজিক: লিস্টিং ডিটেইলস মডাল খোলা/বন্ধ/ডেটা-ভরা
// ব্যবহার: প্রতিটা পেজের <script>-এ import করে কল করুন —
//   const report = initReportModal({ reasons: [...] });
//   initListingDetailModal({ listings, typeNameMap, typeIcons, cardSelector, report });
//
// প্রতিটা কার্ডে data-detail-index={i} অ্যাট্রিবিউট থাকতে হবে (i = array index)।
// আইটেম অবজেক্টে এই ফিল্ডগুলো থাকা দরকার: id, title, price, upazila,
// description, contact_phone, type, images (array)। ভিন্ন ফিল্ড নাম হলে
// কল করার আগে ডেটা normalize করে নিতে হবে।
//
// আপডেট: লাইক + রিপোর্ট (অভিযোগ) সিস্টেম যোগ হলো —
//   - target_type সবসময় 'listing', target_id = item.id
//   - লগইন না থাকলে লাইক ভিউ-অনলি, ফ্ল্যাগ লুকানো (contentEngagement.js
//     এর isLoggedIn()/fetchLikeData()/toggleLike() ব্যবহার হয়)
//   - initListingDetailModal({ ..., report }) — report হলো
//     initReportModal() থেকে পাওয়া ইনস্ট্যান্স, না দিলে ফ্ল্যাগ বাটন
//     কাজ করবে না (কনসোলে ওয়ার্নিং দেখাবে)
// ============================================================

import { fetchLikeData, toggleLike, isLoggedIn } from './contentEngagement.js';

const IMG_FRAME_STYLE =
  'width:100%;aspect-ratio:4/3;object-fit:contain;object-position:center;' +
  'display:block;background:#F4F7FC;';

const ICON_FRAME_STYLE =
  'width:100%;aspect-ratio:4/3;background:#FFF0EA;color:#FF6B35;' +
  'display:flex;align-items:center;justify-content:center;font-size:3rem;';

export function initListingDetailModal({
  listings,
  typeNameMap = {},
  typeIcons = {},
  cardSelector = '[data-detail-index]',
  report = null,
}) {
  const cards = document.querySelectorAll(cardSelector);
  const detailOverlay = document.getElementById('detailOverlay');
  const detailClose = document.getElementById('detailClose');
  const detailImageWrap = document.getElementById('detailImageWrap');
  const detailType = document.getElementById('detailType');
  const detailTitle = document.getElementById('detailTitle');
  const detailPrice = document.getElementById('detailPrice');
  const detailUpazila = document.getElementById('detailUpazila');
  const detailDesc = document.getElementById('detailDesc');
  const detailContact = document.getElementById('detailContact');

  const likeCountView = document.getElementById('detailLikeCountView');
  const likeCountViewNum = document.getElementById('detailLikeCountViewNum');
  const likeBtn = document.getElementById('detailLikeBtn');
  const likeCountNum = document.getElementById('detailLikeCountNum');
  const flagBtn = document.getElementById('detailFlagBtn');

  if (!detailOverlay) return;

  if (!report) {
    console.warn('initListingDetailModal: report ইনস্ট্যান্স পাস করা হয়নি — ফ্ল্যাগ বাটন কাজ করবে না।');
  }

  let currentItem = null;

  async function renderEngagement(item) {
    if (!likeCountView || !likeBtn || !flagBtn) return;

    const loggedIn = await isLoggedIn();
    const { counts, likedByMe } = await fetchLikeData('listing', [item.id]);
    const count = counts[item.id] || 0;
    const liked = likedByMe.has(item.id);

    likeCountViewNum.textContent = count;
    likeCountNum.textContent = count;
    likeBtn.classList.toggle('liked', liked);

    if (loggedIn) {
      likeCountView.style.display = 'none';
      likeBtn.style.display = 'flex';
      flagBtn.style.display = 'flex';
    } else {
      likeCountView.style.display = 'flex';
      likeBtn.style.display = 'none';
      flagBtn.style.display = 'none';
    }

    // onclick রিঅ্যাসাইন করা হচ্ছে (addEventListener জমতে থাকবে না,
    // যেহেতু মডাল বারবার রিইউজ হয় ভিন্ন আইটেমের জন্য)
    likeBtn.onclick = async () => {
      likeBtn.disabled = true;
      const result = await toggleLike('listing', item.id);
      likeBtn.disabled = false;
      if (result.error) return;
      const currentCount = parseInt(likeCountNum.textContent, 10) || 0;
      const newCount = result.liked ? currentCount + 1 : Math.max(currentCount - 1, 0);
      likeCountNum.textContent = newCount;
      likeCountViewNum.textContent = newCount;
      likeBtn.classList.toggle('liked', result.liked);
    };

    flagBtn.onclick = () => {
      if (!report) return;
      report.open('listing', item.id);
    };
  }

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      const item = listings[Number(card.dataset.detailIndex)];
      if (!item) return;
      currentItem = item;

      if (item.images && item.images.length > 0) {
        detailImageWrap.innerHTML = `<img src="${item.images[0]}" alt="${item.title || ''}" style="${IMG_FRAME_STYLE}" />`;
      } else {
        detailImageWrap.innerHTML = `<div style="${ICON_FRAME_STYLE}"><i class="fas ${typeIcons[item.type] || 'fa-box'}"></i></div>`;
      }

      detailType.textContent = typeNameMap[item.type] || item.type || '';
      detailTitle.textContent = item.title || '';
      detailPrice.textContent = item.price ? `৳${item.price}` : '';
      detailPrice.style.display = item.price ? 'block' : 'none';
      detailUpazila.textContent = item.upazila || '';
      detailDesc.textContent = item.description || '';
      detailDesc.style.display = item.description ? 'block' : 'none';
      detailContact.href = `tel:${item.contact_phone || ''}`;

      detailOverlay.classList.add('open');
      document.body.style.overflow = 'hidden';

      if (item.id) renderEngagement(item);
    });
  });

  function closeDetail() {
    detailOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  detailClose?.addEventListener('click', closeDetail);
  detailOverlay?.addEventListener('click', (e) => {
    if (e.target === detailOverlay) closeDetail();
  });

  // AuthModal থেকে লগইন হলে — মডাল খোলা থাকলে লাইভ রিফ্রেশ
  window.addEventListener('smartfeni:auth-changed', () => {
    if (currentItem && detailOverlay.classList.contains('open')) {
      renderEngagement(currentItem);
    }
  });
}