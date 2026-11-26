// ============================================================
// নতুন অ্যাডমিন অ্যাপের মেনু-ট্রি (SF অনুমোদিত, ২৬ নভে ২০২৬)
// কাজের ধরন অনুযায়ী বিভাগ; প্রতিটা অপশনে এক লাইনে "এখানে কী হয়"।
//
// আইটেমের ঘর:
//   name, desc, href      — দেখানো নাম, ব্যাখ্যা, লিংক
//   perm                  — অনুমতি যাচাইয়ের /admin পাথ (না দিলে href)
//   adminOnly / superOnly — শুধু সুপার অ্যাডমিন
//   soon                  — এখনো তৈরি হয়নি (মেনুতে "শীঘ্রই")
//   keys                  — খোঁজার বাড়তি শব্দ
// /admin/... লিংক = এখনো পুরনো প্যানেলে খোলে। নতুন পেজ তৈরি হলে href বদলাও।
// লাকি ড্র ইচ্ছাকৃতভাবে নেই (SF: একেবারে বাদ)।
// ============================================================

export const TODO_ITEMS = [
  { name: 'লিস্টিং অনুমোদন ও এডিট রিভিউ', desc: 'নতুন লিস্টিং ও লিস্টিংয়ের বদল অনুমোদন বা রিজেক্ট', href: '/admin/listings', keys: 'পোস্ট বিজ্ঞাপন' },
  { name: 'ডেলিভারি হিরো ভেরিফিকেশন', desc: 'নতুন রাইডারের কাগজ দেখে অনুমোদন', href: '/admin/delivery-riders', keys: 'রাইডার আবেদন' },
  { name: 'লোকাল ড্রাইভার ভেরিফিকেশন', desc: 'সিএনজি/অটো ড্রাইভারের আবেদন যাচাই', href: '/admin/local-drivers', keys: 'সিএনজি অটো' },
  { name: 'দোকানের আবেদন', desc: 'কুইক ডেলিভারিতে যুক্ত হতে চাওয়া দোকান', href: '/admin/delivery-shop-applications', keys: 'শপ' },
  { name: 'অগ্রিম পেমেন্ট যাচাই', desc: 'কাস্টমারের বিকাশ/নগদ অগ্রিম মিলিয়ে দেখা', href: '/admin/delivery-market-payments', keys: 'বিকাশ নগদ টাকা' },
  { name: 'ক্লাব আবেদন', desc: 'নতুন ক্লাব খোলার আবেদন অনুমোদন', href: '/admin/clubs', adminOnly: true, keys: 'সংগঠন' },
  { name: 'ক্লিনিক প্রতিনিধির আবেদন', desc: 'ক্লিনিকের প্রতিনিধি হতে চাওয়া আবেদন', href: '/admin/clinics', adminOnly: true, keys: 'রিপ্রেজেন্টেটিভ' },
  { name: 'ডাক্তারের সিরিয়াল রিকোয়েস্ট', desc: 'রোগীর সিরিয়াল অনুরোধ দেখা ও নিশ্চিত করা', href: '/admin/doctors', keys: 'সিরিয়াল' },
  { name: 'ডেলিভারি ডিসপিউট', desc: 'কাস্টমার বা রাইডারের অভিযোগ মীমাংসা', href: '/admin/delivery-disputes', keys: 'অভিযোগ সমস্যা' },
  { name: 'লোকাল রাইড রিপোর্ট', desc: 'লোকাল রাইড নিয়ে আসা রিপোর্ট', href: '/admin/local-rides', keys: 'অভিযোগ' },
  { name: 'রেফারের উইথড্র', desc: 'পয়েন্ট তুলতে চাওয়া ইউজারকে টাকা পাঠানো', href: '/admin/referrals', adminOnly: true, keys: 'পয়েন্ট বিকাশ' },
  { name: 'স্ক্রেচ কার্ড বিজয়ীর পেমেন্ট', desc: 'বিজয়ীর নম্বর যাচাই ও টাকা পাঠানো', href: '/admin/scratch-cards', adminOnly: true, keys: 'পুরস্কার' },
];

export const MENU = [
  {
    id: 'todo', name: 'করণীয়', desc: 'অপেক্ষায় থাকা সব অনুমোদন এক জায়গায়',
    icon: '<path d="M9 11l2 2 4-4"/><rect x="4" y="4" width="16" height="16" rx="3"/>',
    items: [{ name: 'সব করণীয়', desc: 'অনুমোদন, যাচাই, অভিযোগ ও পেমেন্ট — এক তালিকায়', href: '/console/todo', always: true }],
  },
  {
    id: 'orders', name: 'অর্ডার', desc: 'সব ধরনের অর্ডার এক জায়গায়',
    icon: '<path d="M3 7h13v10H3z"/><path d="M16 10h3l2 3v4h-5"/><circle cx="7" cy="18" r="1.8"/><circle cx="17.5" cy="18" r="1.8"/>',
    items: [
      { name: 'ডেলিভারি অর্ডার', desc: 'নতুন, ব্যাচ, চলমান ও সম্পন্ন অর্ডার; রাইডার ঠিক করা', href: '/admin/delivery-orders', keys: 'কুইক ডেলিভারি' },
      { name: 'প্রি-অর্ডার', desc: 'দোকানে যাওয়া আগাম অর্ডার ট্র্যাক করা', href: '/console/preorders', perm: '/admin/delivery-orders', soon: true, keys: 'আগাম অর্ডার দোকান' },
      { name: 'ম্যানুয়াল অর্ডার', desc: 'ফোন বা চ্যাটে আসা অর্ডার তোলা ও পাঠানো', href: '/admin/manual-orders', keys: 'ফোন অর্ডার' },
      { name: 'লোকাল রাইড', desc: 'সিএনজি/অটো রাইড: চলমান, কনফার্ম, সম্পন্ন, বাতিল', href: '/admin/local-rides', keys: 'রাইড' },
      { name: 'ব্লাড রিকোয়েস্ট', desc: 'রক্তের অনুরোধ ও ডোনার সাড়া', href: '/admin/blood-requests', keys: 'রক্ত ডোনার' },
    ],
  },
  {
    id: 'market', name: 'মার্কেটপ্লেস', desc: 'কুইক ডেলিভারির দোকান ও মেনু',
    icon: '<path d="M4 9h16l-1.5-5h-13z"/><path d="M5 9v11h14V9"/><path d="M10 20v-6h4v6"/>',
    items: [
      { name: 'দোকান ও মেনু', desc: 'দোকান যোগ, আইটেম, দাম, ছবি, দোকানের ক্রম', href: '/admin/delivery-shops', keys: 'রেস্টুরেন্ট আইটেম' },
      { name: 'শপ ক্যাটাগরি', desc: 'মার্কেটের ক্যাটাগরি (খাবার, মুদি…)', href: '/admin/delivery-categories', adminOnly: true },
      { name: 'দোকানপ্রতি কমিশন', desc: 'কোন দোকান থেকে কত % কমিশন', href: '/admin/delivery-shop-settings', keys: 'কমিশন' },
    ],
  },
  {
    id: 'riders', name: 'রাইডার', desc: 'ডেলিভারি হিরো, লোকাল ড্রাইভার ও নিজস্ব রাইডার',
    icon: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17h4l3-6h4l1 6"/><path d="M13 11l-2-4H8"/>',
    items: [
      { name: 'ডেলিভারি হিরো', desc: 'সব রাইডার, যাচাই ও অবস্থা', href: '/admin/delivery-riders', keys: 'রাইডার' },
      { name: 'লোকাল ড্রাইভার', desc: 'সিএনজি/অটো ড্রাইভারের তালিকা ও যাচাই', href: '/admin/local-drivers' },
      { name: 'ম্যানুয়াল রাইডার ও লেনদেন', desc: 'নিজস্ব রাইডার যোগ ও তাদের টাকার হিসাব', href: '/admin/manual-orders', keys: 'লেনদেন' },
      { name: 'রাইডারের ক্যাশ', desc: 'কোন রাইডারের কাছে কত টাকা জমা', href: '/admin/delivery-market-accounts', keys: 'ক্যাশ হিসাব' },
    ],
  },
  {
    id: 'money', name: 'টাকা-পয়সা', desc: 'কোম্পানি ও মার্কেটপ্লেসের হিসাব',
    icon: '<rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="16" cy="14.5" r="1.5"/>',
    items: [
      { name: 'কোম্পানির হিসাব', desc: 'জমা, আয়, খরচ, দৈনিক হিসাব ও Excel', href: '/admin/hisab', adminOnly: true, keys: 'আয় খরচ ব্যালেন্স' },
      { name: 'মার্কেটপ্লেসের হিসাব', desc: 'দোকানের পাওনা ও লাভ-লস', href: '/admin/delivery-market-accounts', keys: 'পাওনা লাভ লস' },
      { name: 'রেফার ও রিওয়ার্ড', desc: 'রেফারের তালিকা, পয়েন্ট ও লগ', href: '/admin/referrals', adminOnly: true, keys: 'রেফার পয়েন্ট' },
    ],
  },
  {
    id: 'content', name: 'কনটেন্ট', desc: 'লিস্টিং ও সাইটের তথ্য',
    icon: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    items: [
      { name: 'লিস্টিং', desc: 'সব লিস্টিং খোঁজা, এডিট ও রিপোর্ট', href: '/admin/listings', keys: 'পোস্ট বাসা টিউশন' },
      { name: 'জরুরি নম্বর', desc: 'পুলিশ, ফায়ার, হাসপাতালের নম্বর', href: '/admin/emergency-contacts', keys: 'ইমার্জেন্সি' },
      { name: 'টিউটোরিয়াল ও ইনফো', desc: 'ইনফো বাটনের লেখা ও ভিডিও', href: '/admin/tutorials', adminOnly: true, keys: 'ভিডিও' },
    ],
  },
  {
    id: 'health', name: 'স্বাস্থ্য সেবা', desc: 'ডাক্তার, চেম্বার ও ক্লিনিক',
    icon: '<path d="M12 21s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 5.5-7 10-7 10z"/><path d="M12 9v5M9.5 11.5h5"/>',
    items: [
      { name: 'ডাক্তার ও চেম্বার', desc: 'ডাক্তার যোগ, চেম্বারের সময়, মার্জ, ছবি', href: '/admin/doctors', keys: 'চেম্বার মার্জ' },
      { name: 'ক্লিনিক ও প্রতিনিধি', desc: 'ক্লিনিক যোগ ও প্রতিনিধি নিয়োগ', href: '/admin/clinics', adminOnly: true },
      { name: 'সিরিয়ালের পরিসংখ্যান', desc: 'কোন ডাক্তারে কত সিরিয়াল', href: '/admin/doctors', keys: 'পরিসংখ্যান' },
    ],
  },
  {
    id: 'community', name: 'কমিউনিটি', desc: 'ক্লাব ও সংগঠন',
    icon: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M2.5 20c.7-3 3-4.5 5.5-4.5s4.8 1.5 5.5 4.5"/><path d="M13.5 16c.8-.3 1.6-.5 2.5-.5 2.5 0 4.8 1.5 5.5 4.5"/>',
    items: [
      { name: 'ক্লাব', desc: 'ক্লাব তৈরি, ভেরিফাই, মালিক বদল ও ক্রম', href: '/admin/clubs', adminOnly: true, keys: 'সংগঠন' },
    ],
  },
  {
    id: 'team', name: 'ইউজার ও টিম', desc: 'ইউজার, স্টাফ ও তাদের কাজের হিসাব',
    icon: '<circle cx="9" cy="8" r="3.5"/><path d="M3 20c.8-3.4 3.2-5 6-5s5.2 1.6 6 5"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 15c1.6.6 2.6 2.1 3 5"/>',
    items: [
      { name: 'ইউজার', desc: 'ইউজার খোঁজা, ব্লক ও ডিলিটের অপেক্ষা', href: '/admin/users', keys: 'ব্লক' },
      { name: 'স্টাফ, রোল ও পারমিশন', desc: 'কে কোন কাজ করতে পারবে', href: '/admin/roles', adminOnly: true, keys: 'মডারেটর অনুমতি' },
      { name: 'অ্যাক্টিভিটি লগ', desc: 'কে কখন কী অনুমোদন, রিজেক্ট বা বদল করেছে', href: '/console/activity', superOnly: true, keys: 'লগ ইতিহাস' },
    ],
  },
  {
    id: 'marketing', name: 'মার্কেটিং', desc: 'নোটিফিকেশন ও ক্যাম্পেইন',
    icon: '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"/>',
    items: [
      { name: 'নোটিফিকেশন পাঠান', desc: 'নির্দিষ্ট ইউজার, গ্রুপ বা সবাইকে; কে পড়েছে', href: '/admin/notifications', keys: 'পুশ মেসেজ প্রমো' },
      { name: 'স্ক্রেচ কার্ড ক্যাম্পেইন', desc: 'পুরস্কার, সময়কাল ও নিয়ম', href: '/admin/scratch-cards', adminOnly: true, keys: 'পুরস্কার' },
    ],
  },
  {
    id: 'settings', name: 'সেটিং', desc: 'সার্ভিস চালু/বন্ধ, চার্জ, কমিশন ও সাইটের চেহারা',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    items: [
      { name: 'কোন সার্ভিস চালু', desc: 'ডেলিভারি অর্ডার, লোকাল রাইড, রাইড অর্ডার নেওয়া চালু/বন্ধ (অর্ডার পেজের উপরে)', href: '/admin/delivery-orders', keys: 'চালু বন্ধ সুইচ' },
      { name: 'অর্ডারের নিয়ম', desc: 'অটো-পাবলিশ টাইমার, রাইডার কোন উপজেলার অর্ডার পাবে', href: '/admin/delivery-orders', keys: 'টাইমার উপজেলা' },
      { name: 'ডেলিভারি চার্জ', desc: 'দূরত্ব অনুযায়ী চার্জ ও নির্দিষ্ট জায়গার চার্জ', href: '/admin/delivery-fare', adminOnly: true, keys: 'ভাড়া চার্জ' },
      { name: 'কমিশন, পেমেন্ট নম্বর ও অগ্রিম', desc: 'সাধারণ কমিশন %, বিকাশ/নগদ নম্বর, অগ্রিম কে নেবে (হিসাব পেজের সেটিংস)', href: '/admin/delivery-market-accounts', keys: 'বিকাশ নগদ কমিশন' },
      { name: 'হোমপেজ ও ক্যাটাগরি', desc: 'হোমপেজের সেকশনের ক্রম, ক্যাটাগরির সিরিয়াল', href: '/admin/categories', keys: 'সিরিয়াল' },
      { name: 'ছবি', desc: 'ফিচার্ড ছবি, হেডার, ক্যাটাগরির ছবি, লোগো, ছবি ছোট করা', href: '/admin/images', keys: 'লোগো ব্যানার' },
      { name: 'লোকেশন ইম্পোর্ট', desc: 'ম্যাপ থেকে জায়গার নাম যোগ (ডেলিভারির সাজেশন)', href: '/admin/seed-locations', keys: 'OSM ম্যাপ' },
    ],
  },
  {
    id: 'system', name: 'রিপোর্ট ও সিস্টেম', desc: 'ব্যবহারের হিসাব ও প্রযুক্তিগত সমস্যা',
    icon: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    items: [
      { name: 'অ্যানালিটিক্স', desc: 'উপজেলা ও ক্যাটাগরি অনুযায়ী ব্যবহার', href: '/admin/analytics', keys: 'রিপোর্ট' },
      { name: 'ইউজার হেলথ', desc: 'অ্যাপ ধীর বা আটকে যাওয়ার হিসাব', href: '/admin/health', adminOnly: true, keys: 'স্পিড' },
      { name: 'এরর লগ', desc: 'অ্যাপ ও সার্ভারের সমস্যা', href: '/admin/errors', adminOnly: true, keys: 'বাগ ক্র্যাশ' },
      { name: 'ডিভাইস ও আনইনস্টল', desc: 'কতজন অ্যাপ রেখেছে বা মুছেছে', href: '/admin/devices', adminOnly: true, keys: 'অ্যাপ' },
      { name: 'বট চ্যাট', desc: 'স্ক্রিনশট-ইম্পোর্ট বট', href: '/admin/bot-chats', keys: 'বট' },
    ],
  },
];

// অনুমতি অনুযায়ী আইটেম দেখা যাবে কিনা (consoleApp.canOpenAdminPath ইনজেক্ট করা হয়)
export function visibleItem(item, data, canOpenAdminPath) {
  if (!data) return false;
  if (item.always) return true;
  if (item.superOnly) return data.isSuper;
  return canOpenAdminPath(item.perm || item.href, data, !!item.adminOnly);
}

// মেনুর একটা সারি (DOM, সব লেখা textContent দিয়ে)
export function itemEl(item) {
  const isOld = /^\/admin(\/|$)/.test(item.href);
  const tag = item.soon ? 'div' : 'a';
  const a = document.createElement(tag);
  a.className = 'cm-item' + (item.soon ? ' is-soon' : '');
  if (!item.soon) a.href = item.href;
  const t = document.createElement('span');
  t.className = 'cm-item-t';
  const b = document.createElement('b');
  b.textContent = item.name;
  const s = document.createElement('small');
  s.textContent = item.desc;
  t.appendChild(b);
  t.appendChild(s);
  a.appendChild(t);
  if (item.soon) {
    const badge = document.createElement('span');
    badge.className = 'cm-badge';
    badge.textContent = 'শীঘ্রই';
    a.appendChild(badge);
  } else {
    const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arrow.setAttribute('viewBox', '0 0 24 24');
    arrow.setAttribute('aria-hidden', 'true');
    arrow.setAttribute('class', 'cm-arrow');
    arrow.innerHTML = isOld ? '<path d="M7 17 17 7M9 7h8v8"/>' : '<path d="m9 6 6 6-6 6"/>';
    a.appendChild(arrow);
    if (isOld) a.title = 'পুরনো প্যানেলে খুলবে';
  }
  return a;
}
