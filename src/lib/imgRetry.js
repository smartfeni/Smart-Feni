// ============================================================
// ক্যাটাগরি কার্ডের ছবি লোড ফেইল হলে: ১.৫ সেকেন্ড পর একবার রিট্রাই,
// তাতেও না হলে ভাঙা আইকনের বদলে রঙিন প্লেসহোল্ডার।
// প্লেসহোল্ডার JS দিয়ে বানানো, তাই scoped CSS কাজ করে না — inline style।
// ============================================================
const RETRY_DELAY_MS = 1500;

function withRetryParam(src) {
  try {
    const u = new URL(src, window.location.href);
    u.searchParams.set('r', String(Date.now()));
    return u.toString();
  } catch (e) {
    return src;
  }
}

function showPlaceholder(img) {
  const ph = document.createElement('div');
  ph.setAttribute('aria-hidden', 'true');
  ph.style.cssText =
    'width:100%;aspect-ratio:4/3;flex:1;min-height:0;display:block;' +
    'background:linear-gradient(135deg,#fde4d6,#dbe7f6);';
  img.replaceWith(ph);
}

function handleFail(img) {
  if (img.dataset.sfRetried === '1') {
    showPlaceholder(img);
    return;
  }
  img.dataset.sfRetried = '1';
  setTimeout(() => {
    img.src = withRetryParam(img.currentSrc || img.src);
  }, RETRY_DELAY_MS);
}

export function setupCardImages(selector) {
  document.querySelectorAll(selector).forEach((img) => {
    if (img.dataset.sfWired === '1') return;
    img.dataset.sfWired = '1';
    img.addEventListener('error', () => handleFail(img));
    // JS চলার আগেই ছবি ফেইল করে থাকলে
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src')) {
      handleFail(img);
    }
  });
}
