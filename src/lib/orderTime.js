// path: src/lib/orderTime.js
//
// শিডিউল অর্ডারের সময় দেখানোর হেল্পার (ডেলিভারি/রাইড, রাইডার/কাস্টমার/অ্যাডমিন পেজে শেয়ার্ড)।
// is_asap === false && scheduled_at থাকলে "🕐 আজ, বিকাল ৫:০০", নাহলে "⚡ এখনই"।
// ইনলাইন স্টাইল (Astro scoped CSS JS-injected HTML-এ কাজ করে না)।

const TZ = 'Asia/Dhaka';

function dayKey(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

export function isScheduledOrder(req) {
  return !!req && req.is_asap === false && !!req.scheduled_at;
}

export function formatOrderWhen(req) {
  if (!isScheduledOrder(req)) return '⚡ এখনই';
  const d = new Date(req.scheduled_at);
  const k = dayKey(d);
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(Date.now() + 24 * 60 * 60 * 1000));
  const time = new Intl.DateTimeFormat('bn-BD', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d);
  const day = k === today
    ? 'আজ'
    : (k === tomorrow
      ? 'কাল'
      : new Intl.DateTimeFormat('bn-BD', { timeZone: TZ, day: 'numeric', month: 'short' }).format(d));
  return '🕐 ' + day + ', ' + time;
}

export function orderTimeChip(req) {
  if (!req) return '';
  const sched = isScheduledOrder(req);
  const bg = sched ? '#FFF4E5' : '#EAF7EE';
  const fg = sched ? '#7A3E00' : '#1B6B3A';
  const bd = sched ? '#FFD9A8' : '#BFE5CB';
  return '<span style="display:inline-block;margin-bottom:8px;padding:3px 10px;border-radius:999px;font-size:0.78rem;font-weight:800;background:'
    + bg + ';color:' + fg + ';border:1px solid ' + bd + ';">' + formatOrderWhen(req) + '</span>';
}
