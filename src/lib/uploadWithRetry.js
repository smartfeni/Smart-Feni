// path: src/lib/uploadWithRetry.js
// ============================================================
// ইউটিলিটি: স্লো/অস্থির নেটে ছবি আপলোড (XHR + প্রগ্রেস + অটো রিট্রাই)
// কেন: fetch-এ আপলোডের মাঝে কানেকশন ছিঁড়লে সরাসরি 'Failed to fetch'
// হয়ে ফেইল হতো, রিট্রাই ছিল না। এখানে:
//   - XMLHttpRequest: আপলোড প্রগ্রেস (%) পাওয়া যায়, টাইমআউট নিজের হাতে
//   - নেটওয়ার্ক এরর/টাইমআউট/502/503/504 হলে ২ সেকেন্ড, ৪ সেকেন্ড
//     অপেক্ষা করে আরও ২ বার চেষ্টা (মোট ৩ বার)
//   - ৪xx ও ৫00 রিট্রাই হয় না (ওগুলো সার্ভারের সিদ্ধান্ত)
//
// ব্যবহার:
//   const { status, data } = await uploadWithRetry('/api/upload-image', {
//     headers: { Authorization: 'Bearer ...' },
//     makeFormData: () => { const fd = new FormData(); ...; return fd; },
//     onProgress: (pct) => {},
//     onRetry: (n, max) => {},
//   });
// সব চেষ্টা নেটওয়ার্কে ফেইল করলে Error throw করে।
// ============================================================

export function xhrPost(url, { headers = {}, formData, timeoutMs = 60000, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = timeoutMs;
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);

    if (xhr.upload && onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        }
      };
    }

    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch (_) { /* নন-JSON রেসপন্স */ }
      resolve({ status: xhr.status, data });
    };
    xhr.onerror = () => reject(new Error('Failed to fetch'));
    xhr.ontimeout = () => reject(new Error('Upload timeout'));
    xhr.onabort = () => reject(new Error('Upload aborted'));

    xhr.send(formData);
  });
}

const RETRY_STATUS = [502, 503, 504];

// getAuthHeader (ঐচ্ছিক): async (forceRefresh) => ({ Authorization }) | null।
// দেওয়া থাকলে প্রতিটা আপলোডের আগে টাটকা টোকেন বসে, আর ৪০১ এলে একবার জোর
// রিফ্রেশ করে একই চেষ্টায় আবার পাঠানো হয় (রিট্রাই-সংখ্যা খরচ হয় না)।
export async function uploadWithRetry(url, {
  headers,
  getAuthHeader,
  makeFormData,
  timeoutMs = 60000,
  retries = 2,
  onProgress,
  onRetry,
} = {}) {
  let currentHeaders = headers || {};
  if (getAuthHeader) {
    try {
      const h = await getAuthHeader(false);
      if (h) currentHeaders = { ...currentHeaders, ...h };
    } catch (_) { /* পুরনো headers দিয়েই চলবে */ }
  }

  let lastErr = null;
  let authRefreshed = false;
  let attempt = 0;
  let skipWait = false;

  while (true) {
    if (attempt > 0 && !skipWait) {
      if (onRetry) onRetry(attempt, retries);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    skipWait = false;

    try {
      const r = await xhrPost(url, { headers: currentHeaders, formData: makeFormData(), timeoutMs, onProgress });

      if (r.status === 401 && getAuthHeader && !authRefreshed) {
        authRefreshed = true;
        let h = null;
        try { h = await getAuthHeader(true); } catch (_) { h = null; }
        if (h) {
          currentHeaders = { ...currentHeaders, ...h };
          skipWait = true;
          continue;
        }
        return r;
      }

      if (RETRY_STATUS.includes(r.status) && attempt < retries) {
        lastErr = new Error('Server ' + r.status);
        attempt++;
        continue;
      }
      return r;
    } catch (err) {
      lastErr = err;
      if (attempt >= retries) break;
      attempt++;
    }
  }
  throw lastErr || new Error('Failed to fetch');
}
