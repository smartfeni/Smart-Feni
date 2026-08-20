// ============================================================
// স্ক্রিপ্ট: cnglagbe.com থেকে ড্রাইভার লিস্ট স্ক্র্যাপ করে
// Smart Feni-র car-rental ক্যাটাগরিতে upsert করে
//
// রান হয় GitHub Actions cron দিয়ে (দেখুন .github/workflows/scrape-cnglagbe.yml)
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// আপডেট: টেক্সট-পজিশন অনুমানের (আগের লাইন=নাম, পরের লাইন=এলাকা) বদলে
// এখন প্রতিটা tel: লিংক থেকে DOM-এ উপরে উঠে "যতক্ষণ না ঠিক একটামাত্র
// ফোন নম্বর থাকে" এমন সবচেয়ে ছোট কন্টেইনার খুঁজে বের করে, তার ভেতরের
// টেক্সট থেকে নাম/এলাকা বের করে। এটা প্রতিটা কার্ডকে স্বাধীনভাবে পার্স
// করে, তাই সাইটে কোথাও এক্সট্রা লাইন যোগ/বাদ হলেও পুরো লিস্টের বাকি
// এন্ট্রিগুলো শিফট হয়ে এলোমেলো হয়ে যাওয়ার (আগের বাগ) ঝুঁকি নাই।
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

const SOURCE_URL = 'https://www.cnglagbe.com/directory';
const SOURCE_NAME = 'cnglagbe';

const VEHICLE_TYPES = [
  { filterText: 'সিএনজি', type: 'cng' },
  { filterText: 'টোটো', type: 'auto-rickshaw' },
  { filterText: 'অ্যাম্বুলেন্স', type: 'ambulance' },
];

const UPAZILA_ALIASES_ORDERED = [
  ['ছাগলনাইয়া', ['ছাগলনাইয়া']],
  ['দাগনভূঞা', ['দাগনভূঞা', 'দাগনভুঞা', 'দাগনভুয়া']],
  ['পরশুরাম', ['পরশুরাম']],
  ['ফুলগাজী', ['ফুলগাজী', 'ফুলগাজি']],
  ['সোনাগাজী', ['সোনাগাজী', 'সোনাগাজি']],
  ['ফেনী সদর', ['ফেনী সদর', 'সদর', 'ফেনী']],
];

const PHONE_REGEX = /01[3-9]\d{8}/;
const LOADING_TEXT = 'অপেক্ষা করুন';

function matchUpazila(areaText) {
  for (const [upazila, aliases] of UPAZILA_ALIASES_ORDERED) {
    if (aliases.some((alias) => areaText.includes(alias))) {
      return upazila;
    }
  }
  return null;
}

// ============================================================
// DOM-বেইজড এক্সট্রাকশন — প্রতিটা tel: লিংক থেকে উপরে উঠে সবচেয়ে ছোট
// কন্টেইনার বের করে যেখানে ঠিক একটামাত্র ফোন নম্বর আছে (মানে ওইটাই
// সেই কার্ডের সীমানা), তারপর সেই কন্টেইনারের ভেতরের টেক্সট থেকে
// নাম (ফোনের আগের প্রথম লাইন) ও এলাকা (ফোনের পরের বাকি লাইনগুলো) বের করে
// ============================================================
async function extractCardsFromDom(page) {
  return await page.evaluate(() => {
    const phoneRegex = /01[3-9]\d{8}/;
    const globalPhoneRegex = /01[3-9]\d{8}/g;
    const anchors = Array.from(document.querySelectorAll('a[href^="tel:"]'));
    const results = [];

    for (const anchor of anchors) {
      let container = anchor.parentElement;
      let bestContainer = container;

      while (container && container !== document.body) {
        const matches = container.innerText.match(globalPhoneRegex) || [];
        if (matches.length > 1) break; // একাধিক ফোন মানে এটা একাধিক কার্ড ধরে ফেলেছে, তাই আগেরটাই ঠিক
        bestContainer = container;
        container = container.parentElement;
      }

      const text = bestContainer.innerText || '';
      const lines = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

      const phoneIdx = lines.findIndex((l) => phoneRegex.test(l));
      if (phoneIdx === -1) continue;

      const phoneMatch = lines[phoneIdx].match(phoneRegex)[0];
      const name = phoneIdx > 0 ? lines[phoneIdx - 1] : (lines[0] || '');
      const area = lines.slice(phoneIdx + 1).join(', ');

      results.push({ name, phone: phoneMatch, area });
    }

    return results;
  });
}

async function scrollToLoadAll(page, maxRounds = 300) {
  let lastHeight = 0;
  let stableRounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    await page.mouse.wheel(0, 2500);

    const loadingIndicator = page.getByText(LOADING_TEXT, { exact: false }).first();
    await loadingIndicator
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => loadingIndicator.waitFor({ state: 'hidden', timeout: 20000 }))
      .catch(() => {});

    await page.waitForTimeout(600);

    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height === lastHeight) {
      stableRounds++;
      if (stableRounds >= 7) break;
    } else {
      stableRounds = 0;
    }
    lastHeight = height;
  }
}

async function selectVehicleFilter(page, filterText) {
  const chip = page.getByText(filterText, { exact: true }).first();
  await chip.click({ timeout: 10000 });
  await page.waitForTimeout(1000);
}

async function scrapeVehicleType(page, vehicleType) {
  await page.goto(SOURCE_URL, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await selectVehicleFilter(page, vehicleType.filterText);
  await scrollToLoadAll(page);

  const rawDrivers = await extractCardsFromDom(page);

  console.log(`[${vehicleType.type}] raw entries found: ${rawDrivers.length}`);
  return rawDrivers;
}

function buildListingRow(driver, vehicleType) {
  const upazila = matchUpazila(driver.area);

  return {
    category: 'car-rental',
    type: vehicleType.type,
    title: driver.name,
    description: driver.area,
    price: null,
    upazila: upazila,
    images: [],
    contact_phone: driver.phone,
    status: upazila ? 'active' : 'pending',
    is_reviewed: false,
    is_verified: false,
    source: SOURCE_NAME,
    user_id: null,
  };
}

async function fetchBlockedPhones() {
  const { data, error } = await supabase
    .from('scraper_blocklist')
    .select('phone')
    .eq('source', SOURCE_NAME);

  if (error) {
    console.error('ব্লকলিস্ট ফেচ করতে ব্যর্থ (তাই কিছুই বাদ যাবে না):', error.message);
    return new Set();
  }

  return new Set((data || []).map((row) => row.phone));
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    userAgent:
      'Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36',
  });
  page.setDefaultTimeout(30000);

  const allRows = [];

  for (const vehicleType of VEHICLE_TYPES) {
    try {
      const drivers = await scrapeVehicleType(page, vehicleType);
      for (const driver of drivers) {
        allRows.push(buildListingRow(driver, vehicleType));
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

  const blockedPhones = await fetchBlockedPhones();
  const finalRows = uniqueRows.filter((row) => !blockedPhones.has(row.contact_phone));
  const blockedSkippedCount = uniqueRows.length - finalRows.length;

  const outOfFeniCount = finalRows.filter((r) => !r.upazila).length;
  console.log(`ব্লকলিস্টে থাকায় স্কিপ হয়েছে: ${blockedSkippedCount} টি`);
  console.log(`ফেনীর বাইরের এলাকা (pending, upazila খালি): ${outOfFeniCount} টি`);
  console.log(`মোট আপসার্ট হবে: ${finalRows.length} টি এন্ট্রি`);

  if (finalRows.length === 0) {
    console.log('কোনো এন্ট্রি পাওয়া যায়নি — সাইটের স্ট্রাকচার বদলেছে কিনা চেক করা দরকার হতে পারে।');
    return;
  }

  const { error } = await supabase
    .from('listings')
    .upsert(finalRows, { onConflict: 'source,contact_phone' });

  if (error) {
    console.error('Supabase upsert ব্যর্থ:', error.message);
    process.exit(1);
  }

  console.log('সফলভাবে upsert সম্পন্ন হয়েছে।');
}

main();