// ============================================================
// স্ক্রিপ্ট: cnglagbe.com থেকে ড্রাইভার লিস্ট স্ক্র্যাপ করে
// Smart Feni-র car-rental ক্যাটাগরিতে upsert করে
//
// রান হয় GitHub Actions cron দিয়ে (দেখুন .github/workflows/scrape-cnglagbe.yml)
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// ড্রাইভার ডিরেক্টরি পেজ — এখানে ফিল্টার চিপ সরাসরি দেখা যায়
const SOURCE_URL = 'https://www.cnglagbe.com/directory';

// cnglagbe এর ফিল্টার চিপ টেক্সট -> আমাদের সাইটের listing type
const VEHICLE_TYPES = [
  { filterText: 'সিএনজি', type: 'cng' },
  { filterText: 'টোটো', type: 'auto-rickshaw' },
  { filterText: 'অ্যাম্বুলেন্স', type: 'ambulance' },
];

// ফেনীর ৬টা উপজেলা — এলাকার টেক্সটে এইগুলার যেকোনো একটা থাকলেই ম্যাচ ধরা হবে
const UPAZILAS = ['ফেনী সদর', 'ছাগলনাইয়া', 'দাগনভূঞা', 'পরশুরাম', 'ফুলগাজী', 'সোনাগাজী'];
const UPAZILA_ALIASES = {
  'ফেনী সদর': ['ফেনী সদর', 'সদর'],
  ছাগলনাইয়া: ['ছাগলনাইয়া'],
  দাগনভূঞা: ['দাগনভূঞা', 'দাগনভুঞা', 'দাগনভুয়া'],
  পরশুরাম: ['পরশুরাম'],
  ফুলগাজী: ['ফুলগাজী', 'ফুলগাজি'],
  সোনাগাজী: ['সোনাগাজী', 'সোনাগাজি'],
};

const PHONE_REGEX = /01[3-9]\d{8}/;

function matchUpazila(areaText) {
  for (const upazila of UPAZILAS) {
    const aliases = UPAZILA_ALIASES[upazila] || [upazila];
    if (aliases.some((alias) => areaText.includes(alias))) {
      return upazila;
    }
  }
  return null; // ফেনীর বাইরের এলাকা বা অজানা/অসম্পূর্ণ এলাকা — স্কিপ হবে
}

// পেজের innerText থেকে নাম/ফোন/এলাকা ট্রিপলেট বের করা
// প্যাটার্ন: [নাম লাইন] [ফোন নম্বর লাইন] [এলাকা লাইন] — রিপিট হয়
function parseDriversFromText(rawText) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const drivers = [];

  for (let i = 0; i < lines.length; i++) {
    const phoneMatch = lines[i].match(PHONE_REGEX);
    if (!phoneMatch) continue;

    const phone = phoneMatch[0];
    const name = lines[i - 1] || null;
    const nextLine = lines[i + 1] || '';
    const area = PHONE_REGEX.test(nextLine) ? '' : nextLine;

    if (!name || PHONE_REGEX.test(name)) continue;

    drivers.push({ name, phone, area });
  }

  return drivers;
}

async function scrollToLoadAll(page, maxRounds = 50) {
  let lastHeight = 0;
  let stableRounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(700);

    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === lastHeight) {
      stableRounds++;
      if (stableRounds >= 3) break;
    } else {
      stableRounds = 0;
    }
    lastHeight = height;
  }
}

async function selectVehicleFilter(page, filterText) {
  // ফিল্টার চিপে সরাসরি ক্লিক — exact ম্যাচ, যাতে হেডিং টেক্সটের
  // সাথে ভুলবশত না মিলে যায়
  const chip = page.getByText(filterText, { exact: true }).first();
  await chip.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
}

async function scrapeVehicleType(page, vehicleType) {
  await page.goto(SOURCE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await selectVehicleFilter(page, vehicleType.filterText);
  await scrollToLoadAll(page);

  const bodyText = await page.evaluate(() => document.body.innerText);
  const rawDrivers = parseDriversFromText(bodyText);

  console.log(`[${vehicleType.type}] raw entries found: ${rawDrivers.length}`);
  return rawDrivers;
}

function buildListingRow(driver, vehicleType) {
  const upazila = matchUpazila(driver.area);
  if (!upazila) return null;

  return {
    category: 'car-rental',
    type: vehicleType.type,
    title: driver.name,
    description: driver.area,
    price: null,
    upazila,
    images: [],
    contact_phone: driver.phone,
    status: 'active',
    is_reviewed: false,
    is_verified: false,
    source: 'cnglagbe',
    user_id: null,
  };
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  });

  const allRows = [];

  for (const vehicleType of VEHICLE_TYPES) {
    try {
      const drivers = await scrapeVehicleType(page, vehicleType);
      for (const driver of drivers) {
        const row = buildListingRow(driver, vehicleType);
        if (row) allRows.push(row);
      }
    } catch (err) {
      console.error(`[${vehicleType.type}] স্ক্র্যাপ ব্যর্থ:`, err.message);
    }
  }

  await browser.close();

  const seenPhones = new Set();
  const uniqueRows = allRows.filter((row) => {
    if (seenPhones.has(row.contact_phone)) return false;
    seenPhones.add(row.contact_phone);
    return true;
  });

  console.log(`মোট আপসার্ট হবে: ${uniqueRows.length} টি এন্ট্রি`);

  if (uniqueRows.length === 0) {
    console.log('কোনো এন্ট্রি পাওয়া যায়নি — সাইটের স্ট্রাকচার বদলেছে কিনা চেক করা দরকার হতে পারে।');
    return;
  }

  const { error } = await supabase
    .from('listings')
    .upsert(uniqueRows, { onConflict: 'source,contact_phone' });

  if (error) {
    console.error('Supabase upsert ব্যর্থ:', error.message);
    process.exit(1);
  }

  console.log('সফলভাবে upsert সম্পন্ন হয়েছে।');
}

main();