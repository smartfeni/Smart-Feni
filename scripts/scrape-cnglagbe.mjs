// ============================================================
// স্ক্রিপ্ট: cnglagbe.com থেকে ড্রাইভার লিস্ট স্ক্র্যাপ করে
// Smart Feni-র car-rental ক্যাটাগরিতে upsert করে
//
// রান হয় GitHub Actions cron দিয়ে (দেখুন .github/workflows/scrape-cnglagbe.yml)
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// আপডেট:
// - DOM-বেইজড এক্সট্রাকশন (tel: লিংক থেকে কার্ড বাউন্ডারি বের করে,
//   flat-text পজিশন অনুমানের বদলে) — সাইটের লেআউট শিফট হলেও একটা
//   কার্ডের সমস্যা অন্য কার্ডে ছড়ায় না
// - status='active'/'rejected' থাকা এন্ট্রি (ম্যানুয়াল হোক বা
//   auto-match হয়ে) সম্পূর্ণ স্কিপ হয় — একবার সিদ্ধান্ত হয়ে গেলে
//   স্ক্র্যাপার আর কখনো টাচ করে না
// - upsert হয় Postgres ফাংশন upsert_cnglagbe_listings() দিয়ে, কারণ
//   listings টেবিলের unique index টা শুধু source='cnglagbe' এর জন্য
//   partial (অন্য সোর্সে ডুপ্লিকেট ফোন সাপোর্টের জন্য ইচ্ছাকৃত) —
//   Supabase JS ক্লায়েন্টের .upsert() partial index বুঝতে পারে না,
//   তাই raw SQL ফাংশন দিয়ে সঠিক ON CONFLICT ... WHERE ক্লজ ব্যবহার করা হয়
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

// নির্দিষ্ট ৫টা উপজেলার নাম আগে চেক হয়, "ফেনী সদর" সবার শেষে ফলব্যাক
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
  return null; // ফেনী জেলার বাইরের এলাকা হতে পারে
}

// ============================================================
// DOM-বেইজড এক্সট্রাকশন — প্রতিটা tel: লিংক থেকে উপরে উঠে সবচেয়ে ছোট
// কন্টেইনার বের করে যেখানে ঠিক একটামাত্র ফোন নম্বর আছে (কার্ড বাউন্ডারি),
// তারপর সেই কন্টেইনারের ভেতরের টেক্সট থেকে নাম/এলাকা বের করে
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
        if (matches.length > 1) break;
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

// ডেটাবেজে ইতিমধ্যে যেসব ফোন নম্বরের এন্ট্রি "active" বা "rejected"
// (একবার সিদ্ধান্ত হয়ে গেছে, ম্যানুয়ালি হোক বা auto-match হয়ে) —
// সেগুলোর সেট রিটার্ন করে
async function fetchLockedPhones(phones) {
  if (phones.length === 0) return new Set();

  const { data, error } = await supabase
    .from('listings')
    .select('contact_phone, status')
    .eq('source', SOURCE_NAME)
    .in('contact_phone', phones)
    .in('status', ['active', 'rejected']);

  if (error) {
    console.error('লকড ফোন নম্বর চেক করতে ব্যর্থ (তাই কিছুই বাদ যাবে না):', error.message);
    return new Set();
  }

  return new Set((data || []).map((row) => row.contact_phone));
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
  const afterBlocklist = uniqueRows.filter((row) => !blockedPhones.has(row.contact_phone));
  const blockedSkippedCount = uniqueRows.length - afterBlocklist.length;

  const lockedPhones = await fetchLockedPhones(afterBlocklist.map((r) => r.contact_phone));
  const finalRows = afterBlocklist.filter((row) => !lockedPhones.has(row.contact_phone));
  const lockedSkippedCount = afterBlocklist.length - finalRows.length;

  const outOfFeniCount = finalRows.filter((r) => !r.upazila).length;
  console.log(`ব্লকলিস্টে থাকায় স্কিপ হয়েছে: ${blockedSkippedCount} টি`);
  console.log(`আগে থেকেই active/rejected থাকায় স্কিপ হয়েছে: ${lockedSkippedCount} টি`);
  console.log(`ফেনীর বাইরের এলাকা (pending, upazila খালি): ${outOfFeniCount} টি`);
  console.log(`মোট আপসার্ট হবে: ${finalRows.length} টি এন্ট্রি`);

  if (finalRows.length === 0) {
    console.log('কোনো নতুন/পেন্ডিং এন্ট্রি নাই upsert করার মতো।');
    return;
  }

  const { error } = await supabase.rpc('upsert_cnglagbe_listings', { rows: finalRows });

  if (error) {
    console.error('Supabase upsert ব্যর্থ:', error.message);
    process.exit(1);
  }

  console.log('সফলভাবে upsert সম্পন্ন হয়েছে।');
}

main();