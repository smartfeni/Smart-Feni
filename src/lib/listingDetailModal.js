// ============================================================
// শেয়ারড লজিক: লিস্টিং ডিটেইলস মডাল খোলা/বন্ধ/ডেটা-ভরা
// ব্যবহার: প্রতিটা পেজের <script>-এ import করে কল করুন —
//   initListingDetailModal({ listings, typeNameMap, typeIcons, cardSelector });
//
// প্রতিটা কার্ডে data-detail-index={i} অ্যাট্রিবিউট থাকতে হবে (i = array index)।
// আইটেম অবজেক্টে এই ফিল্ডগুলো থাকা দরকার: title, price, upazila, description,
// contact_phone, type, images (array)। ভিন্ন ফিল্ড নাম হলে কল করার আগে
// ডেটা normalize করে নিতে হবে।
// ============================================================

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

  if (!detailOverlay) return;

  cards.forEach((card) => {
    card.addEventListener('click', () => {
      const item = listings[Number(card.dataset.detailIndex)];
      if (!item) return;

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
}