// ============================================================
// শেয়ার্ড Gemini Vision Extraction ফাংশন
//
// housing / recycle / job / repair / tuition / sports: একটা স্ক্রিনশট
//   = একটা লিস্টিং (single object)
// blood: একটা স্ক্রিনশট = একাধিক ডোনার (array)
//
// SUPPORTED_CATEGORIES হলো এই সিস্টেমের একমাত্র "সোর্স অফ ট্রুথ" —
// telegram-webhook.js এবং admin/bot-chats.astro দুটোই এখান থেকে
// ক্যাটাগরি লিস্ট নেয়।
//
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে: GEMINI_API_KEY, GEMINI_MODEL (ঐচ্ছিক)
// ============================================================

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const CATEGORY_CONFIG = {
  housing: {
    instruction:
      'এই স্ক্রিনশটটি একটি ফেসবুক পোস্ট থেকে নেওয়া, যেখানে বাসা ভাড়ার বিজ্ঞাপন আছে। ' +
      'পোস্ট থেকে তথ্য বের করে বাংলায় JSON আকারে দাও। ' +
      'যদি কোনো তথ্য স্ক্রিনশটে না থাকে, সেই ফিল্ড null রাখবে। ফোন নম্বর বাংলাদেশি ফরম্যাটে (01xxxxxxxxx) দিবে।',
    isArray: false,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'সংক্ষিপ্ত শিরোনাম, যেমন: "২ বেডরুম বাসা ভাড়া"' },
        rent_type: { type: 'string', description: 'যেমন: "১ রুম", "২ বেডরুম", "৩ বেডরুম", "বাচেলর", "ফ্ল্যাট" ইত্যাদি' },
        price: { type: 'string', nullable: true, description: 'মাসিক ভাড়া' },
        area: { type: 'string', nullable: true, description: 'এলাকার নাম যা পোস্টে লেখা আছে' },
        phone: { type: 'string', nullable: true },
        description: { type: 'string' },
      },
      required: ['title', 'rent_type', 'description'],
    },
  },
  recycle: {
    instruction:
      'এই স্ক্রিনশটটি ক্রয়-বিক্রয় (পুরাতন জিনিসপত্র) সংক্রান্ত একটি ফেসবুক পোস্ট থেকে নেওয়া। ' +
      'আইটেমের নাম, দাম, কন্ডিশন, ফোন নম্বর এবং এলাকা বের করে JSON আকারে দাও।',
    isArray: false,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        condition: { type: 'string', description: 'যেমন: "নতুন মতো", "ব্যবহৃত", "পুরাতন" ইত্যাদি' },
        price: { type: 'string', nullable: true },
        area: { type: 'string', nullable: true },
        phone: { type: 'string', nullable: true },
        description: { type: 'string' },
      },
      required: ['title', 'condition', 'description'],
    },
  },
  job: {
    instruction:
      'এই স্ক্রিনশটটি একটি চাকরির বিজ্ঞাপন/নোটিশ সংক্রান্ত ফেসবুক পোস্ট থেকে নেওয়া। ' +
      'পদের নাম, প্রতিষ্ঠান, চাকরির ধরন, বেতন, ফোন নম্বর এবং বিবরণ বের করে JSON আকারে দাও।',
    isArray: false,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'যেমন: "সেলস এক্সিকিউটিভ নিয়োগ"' },
        job_type: { type: 'string', description: 'যেমন: "ফুল-টাইম", "পার্ট-টাইম", "চুক্তিভিত্তিক", "ইন্টার্নশিপ"' },
        price: { type: 'string', nullable: true, description: 'বেতন/স্যালারি রেঞ্জ' },
        area: { type: 'string', nullable: true },
        phone: { type: 'string', nullable: true },
        description: { type: 'string' },
      },
      required: ['title', 'job_type', 'description'],
    },
  },
  repair: {
    instruction:
      'এই স্ক্রিনশটটি একটি রিপেয়ার/মেরামত সার্ভিসের বিজ্ঞাপন সংক্রান্ত ফেসবুক পোস্ট থেকে নেওয়া। ' +
      'সার্ভিসের ধরন, দাম/চার্জ, ফোন নম্বর এবং বিবরণ বের করে JSON আকারে দাও।',
    isArray: false,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'যেমন: "এসি/ফ্রিজ মেরামত সার্ভিস"' },
        service_type: { type: 'string', description: 'যেমন: "ইলেকট্রনিক্স", "প্লাম্বিং", "ইলেকট্রিক", "ফার্নিচার" ইত্যাদি' },
        price: { type: 'string', nullable: true, description: 'সার্ভিস চার্জ থাকলে' },
        area: { type: 'string', nullable: true },
        phone: { type: 'string', nullable: true },
        description: { type: 'string' },
      },
      required: ['title', 'service_type', 'description'],
    },
  },
  tuition: {
    instruction:
      'এই স্ক্রিনশটটি টিউশন সংক্রান্ত একটি ফেসবুক পোস্ট থেকে নেওয়া (টিউটর খোঁজা বা টিউটরের অফার, দুটোই হতে পারে)। ' +
      'ক্লাস/বিষয়, বেতন, ফোন নম্বর এবং বিবরণ বের করে JSON আকারে দাও।',
    isArray: false,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'যেমন: "ক্লাস ৯-১০ গণিত/বিজ্ঞান টিউটর প্রয়োজন"' },
        tuition_type: { type: 'string', description: 'যেমন: "হোম টিউটর প্রয়োজন", "টিউটর অফার করছেন", "গ্রুপ স্টাডি" ইত্যাদি, সাথে ক্লাস/বিষয়' },
        price: { type: 'string', nullable: true, description: 'মাসিক বেতন' },
        area: { type: 'string', nullable: true },
        phone: { type: 'string', nullable: true },
        description: { type: 'string' },
      },
      required: ['title', 'tuition_type', 'description'],
    },
  },
  sports: {
    instruction:
      'এই স্ক্রিনশটটি খেলাধুলা বা ইভেন্ট সংক্রান্ত একটি ফেসবুক পোস্ট থেকে নেওয়া (টুর্নামেন্ট, ম্যাচ, ইভেন্ট আয়োজন)। ' +
      'ইভেন্টের ধরন, তারিখ/সময় (যদি থাকে, description এ উল্লেখ করো), ফোন নম্বর এবং বিবরণ বের করে JSON আকারে দাও।',
    isArray: false,
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'যেমন: "আন্তঃক্লাব ফুটবল টুর্নামেন্ট"' },
        event_type: { type: 'string', description: 'যেমন: "টুর্নামেন্ট", "প্রীতি ম্যাচ", "ইভেন্ট আয়োজন"' },
        price: { type: 'string', nullable: true, description: 'রেজিস্ট্রেশন ফি থাকলে' },
        area: { type: 'string', nullable: true },
        phone: { type: 'string', nullable: true },
        description: { type: 'string', description: 'তারিখ/সময় উল্লেখ থাকলে এখানে যোগ করো' },
      },
      required: ['title', 'event_type', 'description'],
    },
  },
  blood: {
    instruction:
      'এই স্ক্রিনশটটি একটি ব্লাড ডোনার লিস্ট/টেবিল থেকে নেওয়া, যেখানে একাধিক ডোনার থাকতে পারে। ' +
      'প্রতিটা ডোনারের নাম, ব্লাড গ্রুপ এবং ফোন নম্বর বের করে JSON array আকারে দাও — একজন হলেও array এর ভেতরে একটা object হিসেবে দিবে। ' +
      'যাদের ফোন নম্বর নাই বা অস্পষ্ট, তাদেরও বাদ দিবে না, phone ফিল্ড null রাখবে।',
    isArray: true,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          blood_group: { type: 'string', description: 'যেমন: "O+", "A-", "AB+", "B+" ইত্যাদি' },
          phone: { type: 'string', nullable: true },
        },
        required: ['name', 'blood_group'],
      },
    },
  },
  // ডাক্তার প্রোফাইল: একটা স্ক্রিনশট = একাধিক ডাক্তার (array), প্রতিজনের চেম্বার ও দিনভিত্তিক সময় সহ।
  // telegram-webhook.js এটা শুধু স্পষ্টভাবে অনুমোদিত চ্যাটে দেখায়। স্পেশালিটির slug তালিকা
  // (specialties টেবিল থেকে) extraInstruction হিসেবে যোগ হয়।
  doctor: {
    instruction:
      'এই স্ক্রিনশটটি ডাক্তারের চেম্বারের বিজ্ঞাপন/পোস্টার (একাধিক ডাক্তার থাকলে প্রত্যেকের আলাদা object)। ' +
      'শুধু ছবিতে যা লেখা আছে তা থেকে তথ্য বের করে JSON array আকারে দাও। কিছু অনুমান করে বানাবে না; না থাকলে null বা খালি array। ' +
      '- name_bn: পদবি সহ নাম হুবহু, যেমন "সহকারী অধ্যাপক ডা. অমুক"। ' +
      '- degrees: ডিগ্রি, কর্মস্থল ও পদবির লেখা এক লাইনে (কমা বা দাঁড়ি দিয়ে জোড়া), রোগের তালিকা বা শিরোনাম বাদে। ' +
      '- bmdc_no: BMDC রেজিস্ট্রেশন নম্বর যেভাবে লেখা আছে (যেমন "এ-৮০০০২")। ' +
      '- chamber_name: চেম্বার/ডায়াগনস্টিক সেন্টার/ক্লিনিকের নাম। chamber_address: তার ঠিকানা। ' +
      '- serial_phones: সিরিয়াল বা অ্যাপয়েন্টমেন্টের মোবাইল নম্বর (সবগুলো), ইংরেজি ডিজিটে, ড্যাশ ছাড়া। সিরিয়ালের আলাদা নম্বর না থাকলে যোগাযোগের নম্বর। ' +
      '- fee: ভিজিট ফি, শুধু স্পষ্ট লেখা থাকলে। ' +
      '- slots: রোগী দেখার সময়, প্রতিটা দিনের জন্য আলাদা object। weekday: রবিবার=0, সোমবার=1, মঙ্গলবার=2, বুধবার=3, বৃহস্পতিবার=4, শুক্রবার=5, শনিবার=6। ' +
      '"প্রতিদিন" হলে ৭ দিন, "অমুক দিন বাদে প্রতিদিন" হলে বাকি দিনগুলো। start ও end ২৪ ঘণ্টার HH:MM ফরম্যাটে ' +
      '("সকাল ১০টা"=10:00, "দুপুর ১টা"=13:00, "বিকাল ৪টা"=16:00, "বিকাল ০৫টা"=17:00, "সন্ধ্যা ৬টা"=18:00, "রাত ৯টা"=21:00)। ' +
      '- note: অন্য দরকারি তথ্য (যেমন "আগে সিরিয়াল নিতে হবে"), না থাকলে null।',
    isArray: true,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name_bn: { type: 'string' },
          degrees: { type: 'string', nullable: true },
          bmdc_no: { type: 'string', nullable: true },
          specialty_slugs: { type: 'array', items: { type: 'string' } },
          chamber_name: { type: 'string', nullable: true },
          chamber_address: { type: 'string', nullable: true },
          serial_phones: { type: 'array', items: { type: 'string' } },
          fee: { type: 'number', nullable: true },
          slots: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                weekday: { type: 'integer' },
                start: { type: 'string' },
                end: { type: 'string' },
              },
              required: ['weekday', 'start', 'end'],
            },
          },
          note: { type: 'string', nullable: true },
        },
        required: ['name_bn', 'specialty_slugs', 'serial_phones', 'slots'],
      },
    },
  },
  // ডেলিভারি দোকানের মেনু: একটা স্ক্রিনশট = একাধিক আইটেম (array)।
  // telegram-webhook.js এটা শুধু স্পষ্টভাবে অনুমোদিত চ্যাটে দেখায়।
  menu: {
    instruction:
      'এই স্ক্রিনশটটি একটি রেস্টুরেন্ট/দোকানের মেনু থেকে নেওয়া (ডেলিভারি অ্যাপ বা মেনু কার্ড)। ' +
      'প্রতিটা খাবারের আইটেমের নাম ও দাম উপর থেকে নিচের ক্রমে JSON array আকারে দাও। ' +
      'নাম স্ক্রিনশটে যেভাবে লেখা আছে সেভাবেই দাও। দাম শুধু সংখ্যা (টাকায়), ইংরেজি ডিজিটে, কোনো চিহ্ন বা ৳ ছাড়া। ' +
      'একই আইটেমের হাফ/ফুল বা সাইজ ভেদে আলাদা দাম থাকলে আলাদা আইটেম করো এবং নামে বন্ধনীতে লেখো, যেমন "বিরিয়ানি (হাফ)"। ' +
      'যে আইটেমের দাম স্পষ্ট দেখা যায় না তা বাদ দাও। অনুমান করে কিছু বানাবে না।',
    isArray: true,
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          price: { type: 'number' },
        },
        required: ['name', 'price'],
      },
    },
  },
};

// প্রতিটা ক্যাটাগরির বাংলা লেবেল + ইমোজি — Telegram বাটন ও Admin UI তে দেখানোর জন্য
const CATEGORY_META = {
  housing: { label: 'বাসা ভাড়া', emoji: '🏠' },
  recycle: { label: 'ক্রয়-বিক্রয়', emoji: '♻️' },
  job: { label: 'চাকরির খবর', emoji: '💼' },
  repair: { label: 'রিপেয়ার সার্ভিস', emoji: '🔧' },
  tuition: { label: 'টিউশন', emoji: '📚' },
  sports: { label: 'খেলাধুলা ও ইভেন্টস', emoji: '⚽' },
  blood: { label: 'ব্লাড ডোনার', emoji: '🩸' },
  menu: { label: 'ডেলিভারি মেনু', emoji: '🍽️' },
  doctor: { label: 'ডাক্তার প্রোফাইল', emoji: '🩺' },
};

// Gemini ৫xx বা নেটওয়ার্ক সমস্যায় একবার আবার চেষ্টা (৪xx-এ নয়)
async function fetchGeminiWithRetry(url, init) {
  let lastRes = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
      if (res.ok || res.status < 500) return res;
      lastRes = res;
    } catch (e) {
      if (attempt === 2) throw e;
    }
    if (attempt === 1) await new Promise((r) => setTimeout(r, 800));
  }
  return lastRes;
}

// telegram-webhook.js ও admin/bot-chats.astro এই লিস্ট থেকে ক্যাটাগরি বাটন/চেকবক্স বানায়
export const SUPPORTED_CATEGORIES = Object.keys(CATEGORY_CONFIG).map((id) => ({
  id,
  label: CATEGORY_META[id]?.label || id,
  emoji: CATEGORY_META[id]?.emoji || '📋',
}));

/**
 * স্ক্রিনশট থেকে structured ডেটা extract করে।
 */
export async function extractListingFromScreenshot({ imageBase64, mimeType, category, extraInstruction = '' }) {
  const config = CATEGORY_CONFIG[category];
  if (!config) throw new Error(`অসমর্থিত ক্যাটাগরি: ${category}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY এনভায়রনমেন্ট ভ্যারিয়েবল সেট করা নাই');

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: config.instruction + (extraInstruction ? '\n\n' + extraInstruction : '') },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: config.schema,
    },
  };

  const response = await fetchGeminiWithRetry(`${GEMINI_API_URL}?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API ব্যর্থ (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawText) throw new Error('Gemini থেকে কোনো JSON রেসপন্স পাওয়া যায়নি');

  return JSON.parse(rawText);
}

/**
 * housing/recycle/job/repair/tuition/sports: extract হওয়া single
 * object + উপজিলা + সংগ্রহ করা আসল ছবি -> `listings` টেবিলের row
 * ফরম্যাটে রূপান্তর করে।
 */
export function buildListingRowFromExtraction(extracted, category, upazila, imageUrls = []) {
  const base = {
    category,
    images: imageUrls,
    status: 'pending',
    is_reviewed: false,
    is_verified: false,
    source: 'screenshot-import',
    user_id: null,
  };

  if (category === 'housing') {
    return {
      ...base,
      type: extracted.rent_type || null,
      title: extracted.title,
      description: extracted.description,
      price: extracted.price || null,
      upazila,
      contact_phone: extracted.phone || null,
    };
  }

  if (category === 'recycle') {
    return {
      ...base,
      type: extracted.condition || null,
      title: extracted.title,
      description: extracted.description,
      price: extracted.price || null,
      upazila,
      contact_phone: extracted.phone || null,
    };
  }

  if (category === 'job') {
    return {
      ...base,
      type: extracted.job_type || null,
      title: extracted.title,
      description: extracted.description,
      price: extracted.price || null,
      upazila,
      contact_phone: extracted.phone || null,
    };
  }

  if (category === 'repair') {
    return {
      ...base,
      type: extracted.service_type || null,
      title: extracted.title,
      description: extracted.description,
      price: extracted.price || null,
      upazila,
      contact_phone: extracted.phone || null,
    };
  }

  if (category === 'tuition') {
    return {
      ...base,
      type: extracted.tuition_type || null,
      title: extracted.title,
      description: extracted.description,
      price: extracted.price || null,
      upazila,
      contact_phone: extracted.phone || null,
    };
  }

  if (category === 'sports') {
    return {
      ...base,
      type: extracted.event_type || null,
      title: extracted.title,
      description: extracted.description,
      price: extracted.price || null,
      upazila,
      contact_phone: extracted.phone || null,
    };
  }

  throw new Error(`buildListingRowFromExtraction: অসমর্থিত ক্যাটাগরি ${category}`);
}

/**
 * blood: extract হওয়া array + কমন উপজিলা/ক্লাব নাম -> `manual_blood_donors` rows
 */
export function buildBloodDonorRows(extractedArray, upazila, clubNameRaw) {
  return extractedArray
    .filter((d) => d.phone)
    .map((d) => ({
      name: d.name,
      phone: d.phone,
      blood_group: d.blood_group,
      upazila,
      club_name_raw: clubNameRaw,
      status: 'pending',
      source: 'screenshot-import',
    }));
}

/**
 * menu: Gemini থেকে আসা array পরিষ্কার করে [{ name, price }] বানায়।
 * নাম খালি বা দাম অবৈধ/০ হলে বাদ (delivery_shop_items.price NOT NULL),
 * একই নাম দুবার থাকলে প্রথমটা রাখে।
 */
export function normalizeMenuItems(extractedArray) {
  const seen = new Set();
  const items = [];
  (Array.isArray(extractedArray) ? extractedArray : []).forEach((it) => {
    const name = String(it?.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const price = Math.round(Number(it?.price) * 100) / 100;
    if (!name || !Number.isFinite(price) || price <= 0 || price > 1000000) return;
    const key = name.normalize('NFC').toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ name, price });
  });
  return items;
}


// ============================================================
// ডাক্তার প্রোফাইল ইম্পোর্ট — Gemini-র উত্তর সার্ভারে যাচাই ও ছাঁটাই
// (AI-র লেখা কিছু সরাসরি ডেটাবেজে যায় না)
// ============================================================
const DOC_BN_DIGITS = '০১২৩৪৫৬৭৮৯';
const docToAscii = (s) => String(s ?? '').replace(/[০-৯]/g, (d) => String(DOC_BN_DIGITS.indexOf(d)));
const docToBn = (s) => String(s ?? '').replace(/[0-9]/g, (d) => DOC_BN_DIGITS[Number(d)]);

function docOneLine(v, max) {
  if (typeof v !== 'string') return null;
  const t = v.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
}

// আগে থেকে ডাটাবেজে থাকা ফরম্যাটে: "এ-৩০৫৪০" বা শুধু "২০৪২০" (বাংলা অঙ্ক)
export function normalizeBmdc(v) {
  if (v == null) return null;
  const s = docToAscii(String(v)).trim();
  const digits = s.replace(/\D/g, '');
  if (digits.length < 3 || digits.length > 7) return null;
  const hasA = /(^|[^a-z])a\s*[-–]?\s*\d/i.test(s) || /এ\s*[-–]?\s*\d/.test(s);
  return (hasA ? 'এ-' : '') + docToBn(digits);
}

function docPhone(v) {
  let d = docToAscii(String(v ?? '')).replace(/[^\d]/g, '');
  if (d.startsWith('880') && d.length === 13) d = '0' + d.slice(3);
  else if (d.length === 10 && d.startsWith('1')) d = '0' + d;
  return /^01[3-9]\d{8}$/.test(d) ? d : null;
}

function docTime(v) {
  const m = docToAscii(String(v ?? '')).trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  return h <= 23 && mi <= 59 ? String(h).padStart(2, '0') + ':' + m[2] : null;
}

// specialties টেবিলের স্লাগ তালিকা থেকে Gemini-কে বলার লাইন
export function doctorSpecialtyInstruction(specialties) {
  const list = (specialties || []).map((s) => `${s.slug} (${s.name_bn})`).join(', ');
  return (
    'specialty_slugs-এ শুধু এই তালিকার slug দাও (একাধিক হলে সবগুলো; ডাক্তার যে রোগের বিশেষজ্ঞ বলে পোস্টের শিরোনামে বা ডিগ্রিতে আছে সেই অনুযায়ী; কোনোটা না মিললে খালি array): ' +
    list +
    '।'
  );
}

// ফেরত: [{ name_bn, degrees, bmdc_no, specialties[], chamber_name, chamber_address,
//          serial_phone, extra_phones[], fee, note, slots:[{weekday,start,end}] }]
export function normalizeDoctors(extractedArray, validSlugs) {
  const valid = validSlugs instanceof Set ? validSlugs : new Set(validSlugs || []);
  const out = [];
  (Array.isArray(extractedArray) ? extractedArray : []).slice(0, 5).forEach((d) => {
    const name = docOneLine(d?.name_bn, 150);
    if (!name || name.length < 3) return;

    const specialties = [
      ...new Set((Array.isArray(d?.specialty_slugs) ? d.specialty_slugs : []).map(String).filter((s) => valid.has(s))),
    ].slice(0, 4);

    const phones = [...new Set((Array.isArray(d?.serial_phones) ? d.serial_phones : []).map(docPhone).filter(Boolean))];

    const seen = new Set();
    const slots = [];
    (Array.isArray(d?.slots) ? d.slots : []).forEach((s) => {
      const wd = Number(s?.weekday);
      const st = docTime(s?.start);
      const en = docTime(s?.end);
      if (!Number.isInteger(wd) || wd < 0 || wd > 6 || !st || !en || en <= st) return;
      const key = `${wd}|${st}|${en}`;
      if (seen.has(key)) return;
      seen.add(key);
      slots.push({ weekday: wd, start: st, end: en });
    });

    const feeNum = Math.round(Number(d?.fee));

    out.push({
      name_bn: name,
      degrees: docOneLine(d?.degrees, 800),
      bmdc_no: normalizeBmdc(d?.bmdc_no),
      specialties,
      chamber_name: docOneLine(d?.chamber_name, 150),
      chamber_address: docOneLine(d?.chamber_address, 300),
      serial_phone: phones[0] || null,
      extra_phones: phones.slice(1, 3),
      fee: Number.isFinite(feeNum) && feeNum > 0 && feeNum <= 100000 ? feeNum : null,
      note: docOneLine(d?.note, 200),
      slots: slots.slice(0, 14),
    });
  });
  return out;
}
