// ============================================================
// শেয়ার্ড Gemini Vision Extraction ফাংশন
// স্ক্রিনশট (base64 ইমেজ) থেকে ক্যাটাগরি অনুযায়ী structured
// ডেটা বের করে — housing (বাসা ভাড়া), blood (ব্লাড ডোনার),
// recycle (ক্রয়-বিক্রয়) সাপোর্ট করে।
//
// ব্যবহৃত হয়: Telegram webhook এবং (পরবর্তীতে) Admin panel থেকে
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে: GEMINI_API_KEY
// ============================================================

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// প্রতিটা ক্যাটাগরির জন্য আলাদা JSON schema + নির্দেশনা
// নোট: Gemini responseSchema OpenAPI 3.0-স্টাইল — nullable ফিল্ডের জন্য
// type: ['string','null'] না লিখে nullable: true লিখতে হয়
const CATEGORY_CONFIG = {
  housing: {
    instruction:
      'এই স্ক্রিনশটটি একটি ফেসবুক পোস্ট থেকে নেওয়া, যেখানে বাসা ভাড়ার বিজ্ঞাপন আছে। ' +
      'পোস্ট থেকে তথ্য বের করে বাংলায় JSON আকারে দাও। ' +
      'যদি কোনো তথ্য স্ক্রিনশটে না থাকে, সেই ফিল্ড null রাখবে। ফোন নম্বর বাংলাদেশি ফরম্যাটে (01xxxxxxxxx) দিবে।',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'সংক্ষিপ্ত শিরোনাম, যেমন: "২ বেডরুম বাসা ভাড়া"' },
        rent_type: { type: 'string', description: 'যেমন: "১ রুম", "২ বেডরুম", "৩ বেডরুম", "বাচেলর", "ফ্ল্যাট" ইত্যাদি' },
        price: { type: 'string', nullable: true, description: 'মাসিক ভাড়া, শুধু সংখ্যা বা "৮০০০ টাকা" ফরম্যাটে' },
        area: { type: 'string', nullable: true, description: 'এলাকার নাম যা পোস্টে লেখা আছে' },
        phone: { type: 'string', nullable: true },
        description: { type: 'string', description: 'পোস্টের বাকি গুরুত্বপূর্ণ তথ্য সংক্ষেপে' },
      },
      required: ['title', 'rent_type', 'description'],
    },
  },
  blood: {
    instruction:
      'এই স্ক্রিনশটটি ব্লাড ডোনার সংক্রান্ত একটি ফেসবুক পোস্ট থেকে নেওয়া। ' +
      'ডোনারের নাম, ব্লাড গ্রুপ, ফোন নম্বর এবং এলাকা বের করে JSON আকারে দাও। ' +
      'একাধিক ডোনার থাকলে শুধু প্রথমজনের তথ্য দাও।',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        blood_group: { type: 'string', description: 'যেমন: "O+", "A-", "AB+", "B+" ইত্যাদি' },
        phone: { type: 'string', nullable: true },
        area: { type: 'string', nullable: true },
      },
      required: ['name', 'blood_group'],
    },
  },
  recycle: {
    instruction:
      'এই স্ক্রিনশটটি ক্রয়-বিক্রয় (পুরাতন জিনিসপত্র) সংক্রান্ত একটি ফেসবুক পোস্ট থেকে নেওয়া। ' +
      'আইটেমের নাম, দাম, কন্ডিশন, ফোন নম্বর এবং এলাকা বের করে JSON আকারে দাও।',
    schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'আইটেমের নাম' },
        condition: { type: 'string', description: 'যেমন: "নতুন মতো", "ব্যবহৃত", "পুরাতন" ইত্যাদি' },
        price: { type: 'string', nullable: true },
        area: { type: 'string', nullable: true },
        phone: { type: 'string', nullable: true },
        description: { type: 'string' },
      },
      required: ['title', 'condition', 'description'],
    },
  },
};

/**
 * স্ক্রিনশট থেকে structured ডেটা extract করে।
 * @param {Object} params
 * @param {string} params.imageBase64 - ছবির base64 ডেটা (data: প্রিফিক্স ছাড়া)
 * @param {string} params.mimeType - যেমন 'image/jpeg', 'image/png'
 * @param {'housing'|'blood'|'recycle'} params.category
 * @returns {Promise<Object>} extract হওয়া raw ডেটা (ক্যাটাগরি-নির্দিষ্ট ফিল্ড সহ)
 */
export async function extractListingFromScreenshot({ imageBase64, mimeType, category }) {
  const config = CATEGORY_CONFIG[category];
  if (!config) {
    throw new Error(`অসমর্থিত ক্যাটাগরি: ${category}`);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY এনভায়রনমেন্ট ভ্যারিয়েবল সেট করা নাই');
  }

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [
          { text: config.instruction },
          {
            inline_data: {
              mime_type: mimeType,
              data: imageBase64,
            },
          },
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

  if (!rawText) {
    throw new Error('Gemini থেকে কোনো JSON রেসপন্স পাওয়া যায়নি');
  }

  return JSON.parse(rawText);
}

/**
 * Extract হওয়া raw ডেটাকে `listings` টেবিলের row ফরম্যাটে রূপান্তর করে।
 * @param {Object} extracted - extractListingFromScreenshot() এর আউটপুট
 * @param {'housing'|'blood'|'recycle'} category
 * @param {string|null} imageUrl - Supabase Storage এ আপলোড হওয়া স্ক্রিনশটের URL
 */
export function buildListingRowFromExtraction(extracted, category, imageUrl) {
  const base = {
    category,
    images: imageUrl ? [imageUrl] : [],
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
      upazila: null,
      contact_phone: extracted.phone || null,
    };
  }

  if (category === 'blood') {
    return {
      ...base,
      type: extracted.blood_group || null,
      title: extracted.name,
      description: extracted.area ? `এলাকা: ${extracted.area}` : null,
      price: null,
      upazila: null,
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
      upazila: null,
      contact_phone: extracted.phone || null,
    };
  }

  throw new Error(`buildListingRowFromExtraction: অসমর্থিত ক্যাটাগরি ${category}`);
}