// ============================================================
// অ্যাডমিন পেজের তালিকা — দ্রুত মেনুর (adminQuickNav.js) জন্য
// ============================================================
// ড্যাশবোর্ডের (/admin) কার্ডগুলোর সাথে মিলিয়ে রাখো। নতুন অ্যাডমিন পেজ/কার্ড যোগ করলে এখানেও এক লাইন যোগ করো।
// adminOnly = true হলে শুধু সুপার অ্যাডমিন দেখে (ড্যাশবোর্ডের data-admin-only-র মতো)।
// স্টাফের জন্য পারমিশন চেক adminGuard.js-এর adminAreaOfPath + access.can দিয়ে হয়।
// ============================================================

export const ADMIN_GROUPS = [
  { id: 'content', name: 'কনটেন্ট' },
  { id: 'team', name: 'ইউজার ও টিম' },
  { id: 'market', name: 'মার্কেটপ্লেস' },
  { id: 'delivery', name: 'ডেলিভারি' },
  { id: 'health', name: 'স্বাস্থ্য ও আইন' },
  { id: 'growth', name: 'গ্রোথ ও টাকা' },
  { id: 'system', name: 'সিস্টেম' },
];

// [গ্রুপ, পুরো নাম, ছোট নাম, href, FontAwesome আইকন, adminOnly, খোঁজার বাড়তি শব্দ]
const ROWS = [
  ['content', 'ক্যাটাগরি ম্যানেজমেন্ট', 'ক্যাটাগরি', '/admin/categories', 'fa-layer-group', false, 'হোমপেজ সেকশন সিরিয়াল'],
  ['content', 'ছবি ম্যানেজমেন্ট', 'ছবি', '/admin/images', 'fa-image', false, 'ফিচার্ড ফটো হেডার লোগো'],
  ['content', 'নোটিফিকেশন', 'নোটিফিকেশন', '/admin/notifications', 'fa-bell', false, 'ক্যাম্পেইন কাস্টম'],
  ['content', 'জরুরি নাম্বার', 'জরুরি নাম্বার', '/admin/emergency-contacts', 'fa-phone-volume', false, 'পুলিশ ফায়ার হাসপাতাল ইমার্জেন্সি'],
  ['content', 'টিউটোরিয়াল ও ইনফো', 'টিউটোরিয়াল', '/admin/tutorials', 'fa-circle-play', true, 'ভিডিও ইউটিউব ব্যাখ্যা'],
  ['team', 'রোল ও পারমিশন', 'রোল', '/admin/roles', 'fa-user-lock', true, 'স্টাফ অনুমতি'],
  ['market', 'শপ ম্যানেজমেন্ট', 'শপ', '/admin/shops', 'fa-store', false, 'দোকান'],
  ['market', 'শপ অর্ডার', 'শপ অর্ডার', '/admin/shop-orders', 'fa-bag-shopping', false, 'অর্ডার ট্র্যাকিং'],
  ['market', 'ক্লাব ম্যানেজমেন্ট', 'ক্লাব', '/admin/clubs', 'fa-people-group', true, 'ভেরিফাই'],
  ['delivery', 'কুইক ডেলিভারি', 'কুইক ডেলিভারি', '/admin/quick-delivery', 'fa-bolt', false, 'অগ্রিম পেমেন্ট বিকাশ নগদ হিসাব চার্জ'],
  ['delivery', 'ডেলিভারি হিরো ভেরিফিকেশন', 'রাইডার আবেদন', '/admin/delivery-riders', 'fa-motorcycle', false, 'রাইডার যাচাই'],
  ['delivery', 'ডেলিভারি দোকান ও মেনু', 'দোকান ও মেনু', '/admin/delivery-shops', 'fa-utensils', false, 'রেস্টুরেন্ট আইটেম দাম'],
  ['delivery', 'ডেলিভারি ডিসপিউট', 'ডিসপিউট', '/admin/delivery-disputes', 'fa-flag', false, 'রিপোর্ট সমস্যা রিজলভ'],
  ['delivery', 'লোকেশন ইম্পোর্ট', 'লোকেশন', '/admin/seed-locations', 'fa-map-location-dot', false, 'OSM সাজেশন'],
  ['delivery', 'লোকাল রাইড ড্রাইভার', 'লোকাল ড্রাইভার', '/admin/local-drivers', 'fa-van-shuttle', false, 'সিএনজি অটো আবেদন'],
  ['delivery', 'লোকাল রাইড মনিটর', 'রাইড মনিটর', '/admin/local-rides', 'fa-route', false, 'রিকোয়েস্ট রিপোর্ট সিএনজি অটো'],
  ['health', 'ডাক্তার ম্যানেজমেন্ট', 'ডাক্তার', '/admin/doctors', 'fa-user-doctor', false, 'চেম্বার মার্জ'],
  ['health', 'ক্লিনিক ও প্রতিনিধি', 'ক্লিনিক', '/admin/clinics', 'fa-hospital', true, 'প্রতিনিধি নিয়োগ'],
  ['health', 'ব্লাড রিকোয়েস্ট', 'ব্লাড', '/admin/blood-requests', 'fa-droplet', false, 'রক্ত ডোনার'],
  ['growth', 'রেফার & রিওয়ার্ড', 'রেফার', '/admin/referrals', 'fa-coins', true, 'উইথড্র পয়েন্ট'],
  ['growth', 'হিসাব', 'হিসাব', '/admin/hisab', 'fa-wallet', true, 'জমা আয় খরচ ব্যালেন্স'],
  ['growth', 'স্ক্রেচ কার্ড', 'স্ক্রেচ কার্ড', '/admin/scratch-cards', 'fa-gift', true, 'লাকি ড্র বিজয়ী বিকাশ'],
  ['growth', 'অ্যানালিটিক্স', 'অ্যানালিটিক্স', '/admin/analytics', 'fa-chart-line', false, 'উপজেলা সাইনআপ কল ক্লিক'],
  ['growth', 'Bot Chats', 'Bot Chats', '/admin/bot-chats', 'fa-robot', false, 'টেলিগ্রাম বট'],
  ['system', 'এরর লগ', 'এরর লগ', '/admin/errors', 'fa-bug', true, 'বাগ ক্র্যাশ সমস্যা'],
  ['system', 'ডিভাইস ও আনইনস্টল', 'ডিভাইস', '/admin/devices', 'fa-mobile-screen', true, 'অ্যাপ ইনস্টল পুশ গেস্ট'],
];

export const ADMIN_PAGES = ROWS.map(([group, name, short, href, icon, adminOnly, extra]) => ({
  group, name, short, href, icon, adminOnly,
  search: (name + ' ' + short + ' ' + extra).toLowerCase(),
}));
