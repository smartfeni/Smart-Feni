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
};

// telegram-webhook.js ও admin/bot-chats.astro এই লিস্ট থেকে ক্যাটাগরি বাটন/চেকবক্স বানায়
export const SUPPORTED_CATEGORIES = Object.keys(CATEGORY_CONFIG).map((id) => ({
  id,
  label: CATEGORY_META[id]?.label || id,
  emoji: CATEGORY_META[id]?.emoji || '📋',
}));

/**
 * স্ক্রিনশট থেকে structured ডেটা extract করে।
 */
export async function extractListingFromScreenshot({ imageBase64, mimeType, category }) {
  const config = CATEGORY_CONFIG[category];
  if (!config) throw new Error(`অসমর্থিত ক্যাটাগরি: ${category}`);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY এনভায়রনমেন্ট ভ্যারিয়েবল সেট করা নাই');

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: config.instruction },
          { inline_data: { mime_type: mimeType, data: imageBase64 } },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: config.schema,
    },
  };

  const response = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
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