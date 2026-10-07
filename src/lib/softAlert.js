// ============================================================
// নেটিভ alert() পপ-আপের বদলে ছোট টোস্ট (window.showToast — BaseLayout এ ডিফাইন করা)
//
// কেন: ডেলিভারি/রাইড হিরো ও my-orders পেজে সাধারণ মেসেজ ("ব্যর্থ হয়েছে", "সঠিক দাম দাও"
// ইত্যাদি) নেটিভ ডায়ালগে আসছিল, যা সব জায়গায় ভালো দেখায় না। এখন alert() ডাকলে
// টোস্ট দেখায়। confirm() ছোঁয়া হয়নি — "বাতিল করবেন?"/"সম্পন্ন করবেন?" ধরনের
// গুরুত্বপূর্ণ নিশ্চিতকরণ নেটিভ মডালেই থাকে।
//
// অ্যাডমিন পেজে (/admin) কিছু বদলায় না। showToast না থাকলে (ব্যতিক্রম) পুরনো নেটিভ
// alert-ই চলে, তাই কোনো মেসেজ হারাবে না।
// ============================================================

export function installSoftAlert() {
  if (typeof window === 'undefined' || window.__sfSoftAlertInstalled) return;
  window.__sfSoftAlertInstalled = true;

  if (window.location.pathname.startsWith('/admin')) return;

  const nativeAlert = window.alert.bind(window);

  window.alert = function (message) {
    const text = String(message ?? '');
    if (typeof window.showToast !== 'function' || !document.getElementById('sf-toast-overlay')) {
      nativeAlert(text);
      return;
    }
    const isSuccess = /সফল|ধন্যবাদ|✓|✅/.test(text);
    // বড় মেসেজ পড়ার সময় পাওয়ার জন্য একটু বেশি সময়
    const duration = Math.min(6000, 3000 + text.length * 40);
    window.showToast(text, isSuccess ? 'success' : 'error', duration);
  };
}