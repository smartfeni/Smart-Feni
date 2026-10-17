// path: src/lib/price.js
// ============================================================
// ইউটিলিটি: শপ প্রোডাক্টের দাম — শুধু সংখ্যা সেভ, ৳ সিম্বল ডিসপ্লেতে অটো
// কেন লাগলো: দাম টেক্সট কলামে ফ্রি-টেক্সট ছিল ("৪২০ টাকা", "৳১০০", "১,৫০০ প্রতি কেজি"),
// তাই ডিসপ্লেতে ডাবল ৳ আসত। নতুন নিয়ম: ইউজার শুধু সংখ্যা লেখে (listings.price এ
// ইংরেজি অঙ্ক), একক আলাদা কলামে (listings.price_unit), ডিসপ্লেতে formatPrice()।
// পুরনো টেক্সট-দামও formatPrice() ঠিকভাবে দেখায় (ডাবল ৳ হয় না)।
//
// ব্যবহার:
//   import { formatPrice, sanitizePriceInput } from '../../lib/price.js';
//   formatPrice('1500', 'কেজি')   // "৳১,৫০০ / কেজি"
//   formatPrice('৪২০ টাকা')        // "৳৪২০"
//   sanitizePriceInput('৳১০০ টাকা') // "100"
// ============================================================

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

export const PRICE_UNITS = ['কেজি', 'গ্রাম', 'পিস', 'ডজন', 'লিটার', 'প্যাকেট'];

export function toAsciiDigits(value) {
  return String(value ?? '').replace(/[০-৯]/g, (d) => String(BN_DIGITS.indexOf(d)));
}

export function toBnDigits(value) {
  return String(value ?? '').replace(/[0-9]/g, (d) => BN_DIGITS[Number(d)]);
}

// ইনপুট বক্সের জন্য: বাংলা অঙ্ক ইংরেজিতে, বাকি সব (৳, "টাকা", কমা, স্পেস) বাদ
export function sanitizePriceInput(raw) {
  return toAsciiDigits(raw).replace(/\D/g, '');
}

// পুরনো/নতুন যেকোনো দাম থেকে সংখ্যা ও বাকি লেখা আলাদা করা
// "৫০ টাকা" -> {50, ''} · "১ পিস ৫০ টাকা" -> {50, '১ পিস'} · "১,৫০০ প্রতি কেজি" -> {1500, 'কেজি'}
// সংখ্যা না থাকলে (যেমন "মিনিট এমবি অফার") amount = null
export function parsePriceText(raw) {
  const original = String(raw ?? '').trim();
  if (!original) return { amount: null, rest: '' };

  const s = toAsciiDigits(original).replace(/(\d),(?=\d)/g, '$1');
  let m = s.match(/(\d+(?:\.\d+)?)\s*(?:টাকা|৳|\/-|tk\b)/i);
  if (!m) m = s.match(/(?:৳|tk\.?)\s*(\d+(?:\.\d+)?)/i);
  let amountStr = m ? m[1] : null;
  let rest = m ? (s.slice(0, m.index) + ' ' + s.slice(m.index + m[0].length)) : s;

  if (!m) {
    const n = s.match(/\d+(?:\.\d+)?/);
    if (!n) return { amount: null, rest: original };
    amountStr = n[0];
    rest = s.slice(0, n.index) + ' ' + s.slice(n.index + n[0].length);
  }

  rest = rest
    .replace(/টাকা|৳|\/-|মাত্র/g, ' ')
    .replace(/^\s*[/\-–:]+\s*|\s*[/\-–:]+\s*$/g, ' ')
    .replace(/^\s*প্রতি\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();

  const amount = Number(amountStr);
  if (!Number.isFinite(amount)) return { amount: null, rest: original };
  return { amount, rest: toBnDigits(rest) };
}

// হিসাবের জন্য সংখ্যা (না পেলে 0)
export function priceToNumber(raw) {
  const { amount } = parsePriceText(raw);
  return amount === null ? 0 : amount;
}

function formatAmount(n) {
  let out;
  try {
    out = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n);
  } catch (e) {
    out = String(n);
  }
  return toBnDigits(out);
}

// ডিসপ্লে: "৳১,৫০০ / কেজি"। unit দিলে সেটাই, নইলে পুরনো টেক্সটের বাকি অংশ।
// সংখ্যা না থাকলে মূল লেখাই ফেরত (৳ ছাড়া)।
export function formatPrice(price, unit) {
  const raw = String(price ?? '').trim();
  if (!raw) return '';
  const { amount, rest } = parsePriceText(raw);
  if (amount === null) return raw;
  const u = (unit && String(unit).trim()) || rest;
  return `৳${formatAmount(amount)}${u ? ' / ' + u : ''}`;
}

// পুরনো টেক্সট-দাম এডিট করার সময় এককের আন্দাজ (শুধু পরিচিত একক মিললে)
export function guessUnit(raw) {
  const s = String(raw ?? '');
  for (const u of PRICE_UNITS) {
    if (s.includes(u)) return u;
  }
  return '';
}
