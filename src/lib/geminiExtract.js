// ============================================================
// শেয়ার্ড Gemini Vision Extraction ফাংশন
//
// housing / recycle: একটা স্ক্রিনশট = একটা লিস্টিং (single object)
// blood: একটা স্ক্রিনশট = একাধিক ডোনার (array) — উপজিলা ও ক্লাব
//        নাম আলাদাভাবে অ্যাডমিনের কাছ থেকে নেওয়া হয়, তাই
//        extraction শুধু নাম/ব্লাড গ্রুপ/ফোন বের করে
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
};

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

// housing/recycle: extract হওয়া single object + সংগ্রহ করা আসল ছবি -> listings row
export function buildListingRowFromExtraction(extracted, category, imageUrls = []) {
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

// blood: extract হওয়া array + কমন উপজিলা/ক্লাব -> manual_blood_donors rows
export function buildBloodDonorRows(extractedArray, upazila, clubNameRaw) {
  return extractedArray
    .filter((d) => d.phone) // ফোন নাম্বার ছাড়া এন্ট্রি বাদ (unique constraint আছে)
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