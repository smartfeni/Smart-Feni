// ============================================================
// পুরনো অ্যাডমিন প্যানেলের লিংক (/admin/...) → নতুন অ্যাডমিন অ্যাপের পেজ (/console/...)
// ব্যবহার: অ্যাডমিন অ্যাপে push ট্যাপ (proApp.js scopedAppPath), কনসোলের ইনবক্স ও অন্য লিংক।
// নোটিফিকেশনের action_url ডাটাবেসে /admin/... থাকে (মেইন অ্যাপ/ব্রাউজারে পুরনো প্যানেলই খোলে);
// শুধু কনসোলের ভেতরে এখানে বদলায়। যে পেজের নতুন রূপ নেই (যেমন /admin/images/...) সেটা অপরিবর্তিত।
// নতুন কনসোল পেজ বানালে নিচের SIMPLE তালিকায় লাইন যোগ করো।
// ============================================================

// পুরনো পাথ → নতুন পাথ (query যেমন আছে তেমন যায়: ?tab=, ?q=, ?notif= ...)
const SIMPLE = {
  'manual-orders': 'manual-orders',
  'delivery-market-payments': 'payments',
  'delivery-market-accounts': 'money',
  'delivery-disputes': 'disputes',
  'delivery-shop-applications': 'shop-apps',
  'delivery-shops': 'shops',
  'delivery-categories': 'market-cats',
  'delivery-fare': 'delivery-fare',
  'delivery-riders': 'riders',
  'local-drivers': 'drivers',
  'local-rides': 'local-rides',
  listings: 'listings',
  'scratch-cards': 'scratch-cards',
  referrals: 'referrals',
  errors: 'errors',
  health: 'health',
  devices: 'devices',
  clubs: 'clubs',
  clinics: 'clinics',
  doctors: 'doctors',
  users: 'users',
  roles: 'roles',
  moderators: 'roles',
  'blood-requests': 'blood-requests',
  'bot-chats': 'bot-chats',
  notifications: 'notifications',
  analytics: 'analytics',
  categories: 'categories',
  'emergency-contacts': 'emergency',
  tutorials: 'tutorials',
  'seed-locations': 'seed-locations',
  hisab: 'hisab',
  'quick-delivery': 'orders',
};

const ORDER_TABS = ['new', 'live', 'history'];

export function consoleUrl(href) {
  try {
    const u = new URL(String(href || ''), 'https://x.invalid');
    const m = /^\/admin(?:\/([^/]+))?\/?$/.exec(u.pathname);
    if (!m) return href; // /admin নয়, বা /admin/images/... এর মতো ভেতরের পাতা
    const page = m[1] || '';
    const q = new URLSearchParams(u.search);
    const keep = (path, params) => {
      const s = params.toString();
      return path + (s ? '?' + s : '') + u.hash;
    };

    if (!page) return keep('/console', q);

    if (page === 'delivery-orders') {
      const open = q.get('open');
      if (open) {
        q.delete('open');
        q.set('no', open);
        return keep('/console/order', q);
      }
      const tab = q.get('tab');
      if (tab && !ORDER_TABS.includes(tab)) q.delete('tab');
      return keep('/console/orders', q);
    }

    const to = SIMPLE[page];
    return to ? keep('/console/' + to, q) : href;
  } catch (_) {
    return href;
  }
}
