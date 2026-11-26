// ============================================================
// consoleOrders.js — নতুন অ্যাডমিন অ্যাপের অর্ডার পেজগুলোর শেয়ার্ড লেবেল ও হেল্পার
// ব্যবহার: /console/orders (তালিকা), /console/order (বিস্তারিত)
// স্ট্যাটাস/ইভেন্টের বাংলা নাম পুরনো /admin/delivery-orders-এর সাথে মিলিয়ে রাখা।
// ============================================================

const BN = '০১২৩৪৫৬৭৮৯';
const bnDigits = (v) => String(v).replace(/\d/g, (d) => BN[Number(d)]);

// fg/bg = ব্যাজের রং
export const ORDER_STATUS = {
  pending:   { name: 'পাবলিশের অপেক্ষায়', fg: '#B45309', bg: '#FFF4E0' },
  hold:      { name: 'অপেক্ষায় রাখা', fg: '#1D4ED8', bg: '#EAF1FF' },
  open:      { name: 'অফার নিচ্ছে', fg: '#C2410C', bg: '#FFF1E8' },
  confirmed: { name: 'রাইডার ঠিক হয়েছে', fg: '#1D4ED8', bg: '#EAF1FF' },
  delivered: { name: 'ডেলিভারড', fg: '#6D28D9', bg: '#F3EEFF' },
  completed: { name: 'সম্পন্ন', fg: '#17663F', bg: '#E6F6EE' },
  cancelled: { name: 'বাতিল', fg: '#6B7891', bg: '#F1F4F8' },
  expired:   { name: 'মেয়াদ শেষ', fg: '#6B7891', bg: '#F1F4F8' },
  disputed:  { name: 'ডিসপিউট', fg: '#B3261E', bg: '#FDECEA' },
};

// পাবলিশ না হওয়া খোলা অর্ডার = pending/hold, বাকিটা eff_status
export function orderStatusOf(o) {
  if (!o) return '';
  if (o.status === 'open' && (o.publish_status === 'pending' || o.publish_status === 'hold')) return o.publish_status;
  return o.eff_status || o.status;
}

export function money(v) {
  if (v === null || v === undefined || v === '') return '—';
  return '৳' + bnDigits(Math.round(Number(v)));
}

export const EVENT_INFO = {
  created: 'নতুন অর্ডার এসেছে',
  offer_made: 'অফার এসেছে',
  status_confirmed: 'রাইডার ঠিক হয়েছে',
  pickup_done: 'পিকআপ হয়েছে',
  status_delivered: 'রাইডার ডেলিভারড মার্ক করেছেন',
  status_completed: 'সম্পন্ন হয়েছে',
  status_cancelled: 'বাতিল হয়েছে',
  status_disputed: 'ডিসপিউট খোলা হয়েছে',
  dispute_resolved: 'ডিসপিউট নিষ্পত্তি হয়েছে',
  rider_alert: 'রাইডারদের এলার্ট পাঠানো হয়েছে',
  status_open: 'আবার খোলা হয়েছে',
  published: 'পাবলিশ হয়েছে',
  hold: 'অপেক্ষায় রাখা হয়েছে',
  unhold: 'অপেক্ষা থেকে ছাড়া হয়েছে',
  assigned: 'অ্যাডমিন রাইডারকে দিয়েছেন',
  transferred: 'অন্য রাইডারকে দেওয়া হয়েছে',
  rider_released: 'রাইডার অর্ডার ছেড়েছেন, মার্কেটে ফিরেছে',
  release_requested: 'রাইডার অর্ডার ছাড়তে চেয়েছেন',
  release_rejected: 'ছাড়ার অনুরোধ নাকচ, রাইডারই থাকছেন',
  release_withdrawn: 'রাইডার ছাড়ার অনুরোধ তুলে নিয়েছেন',
  reopened: 'অ্যাডমিন মার্কেটে ফেরত দিয়েছেন',
  deal_started: 'অ্যাডমিন ডিল চ্যাট শুরু করেছেন',
  deal_offer: 'অ্যাডমিন চার্জ প্রস্তাব দিয়েছেন',
  deal_accepted: 'কাস্টমার প্রস্তাব মেনেছেন',
  deal_declined: 'কাস্টমার প্রস্তাব নাকচ করেছেন',
  admin_note: 'অ্যাডমিন নোট',
  price_changed: 'কাস্টমার চাওয়া দাম বদলেছেন',
};

export function eventText(ev) {
  const base = EVENT_INFO[ev.event_type] || ev.event_type;
  const m = ev.meta || {};
  if (ev.event_type === 'offer_made' && m.price) return base + ' (' + money(m.price) + ')';
  if (ev.event_type === 'rider_alert' && m.sent !== undefined) return base + ' (' + bnDigits(m.sent) + ' জনকে)';
  if (ev.event_type === 'price_changed' && m.new_price) return base + ' (' + money(m.old_price) + ' → ' + money(m.new_price) + ')';
  return base;
}

export const DISPUTE_RESULT = {
  resolve_completed: 'রাইডারের পক্ষে (সম্পন্ন)',
  resolve_cancelled: 'ডিল বাতিল',
  reassigned: 'নতুন রাইডারকে দেওয়া হয়েছে',
  reopened: 'মার্কেটে ফেরত দেওয়া হয়েছে',
  admin_cancelled: 'অ্যাডমিন বাতিল করেছেন',
};
