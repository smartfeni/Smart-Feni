// ============================================================
// Telegram Webhook — স্ক্রিনশট থেকে লিস্টিং ইম্পোর্ট (multi-step)
// + মাল্টি-চ্যাট সাপোর্ট: `telegram_bot_chats` টেবিল থেকে অনুমোদিত
// চ্যাট লিস্ট চেক হয় (moderator + category-ভিত্তিক ডেডিকেটেড চ্যাট)
//
// অনুমোদিত না এমন চ্যাট থেকে মেসেজ এলে অটো-ডিটেক্ট করে pending
// row হিসেবে সেভ হয় — Admin panel এ /admin/bot-chats পেজে
// Approve করলেই কাজ শুরু। নতুন pending রিকোয়েস্ট এলে
// notify_on_new_request=true থাকা চ্যাটগুলাতে নোটিফিকেশন যায়
//
// ক্যাটাগরি লিস্ট geminiExtract.js এর SUPPORTED_CATEGORIES থেকে আসে
//
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে:
// TELEGRAM_BOT_TOKEN, GEMINI_API_KEY,
// PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import {
  extractListingFromScreenshot,
  buildListingRowFromExtraction,
  buildBloodDonorRows,
  normalizeMenuItems,
  SUPPORTED_CATEGORIES,
} from '../../lib/geminiExtract.js';

export const prerender = false;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CATEGORY_LABELS = Object.fromEntries(SUPPORTED_CATEGORIES.map((c) => [c.id, c.label]));
const CATEGORY_EMOJIS = Object.fromEntries(SUPPORTED_CATEGORIES.map((c) => [c.id, c.emoji]));
const ALL_CATEGORY_IDS = SUPPORTED_CATEGORIES.map((c) => c.id);

// 'menu' (ডেলিভারি মেনু ইম্পোর্ট) শুধু allowed_categories-এ স্পষ্টভাবে থাকলে দেখায়;
// "সব ক্যাটাগরি" (null) চ্যাটে আসে না। মেনুর ছবি যায় delivery-shop-images বাকেটে।
const MENU_CATEGORY = 'menu';
const MENU_BUCKET = 'delivery-shop-images';
const MENU_MAX_BYTES = 3 * 1024 * 1024;

// Vercel env TELEGRAM_WEBHOOK_SECRET সেট থাকলে ও setWebhook-এ একই secret_token দিলে,
// শুধু Telegram-এর পাঠানো রিকোয়েস্ট চলবে। env সেট না থাকলে আগের মতোই চলে।
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

const UPAZILA_LIST = ['ফেনী সদর', 'ছাগলনাইয়া', 'দাগনভূঞা', 'পরশুরাম', 'ফুলগাজী', 'সোনাগাজী'];

async function tg(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// notify_on_new_request=true থাকা সব চ্যাটে নোটিফিকেশন পাঠায়
async function notifyAdminsOfNewRequest(label, chatId) {
  const { data: notifyChats } = await supabase
    .from('telegram_bot_chats')
    .select('chat_id')
    .eq('notify_on_new_request', true)
    .eq('is_active', true);

  if (!notifyChats || notifyChats.length === 0) return;

  const text = `🔔 নতুন Bot Chat অ্যাক্সেস রিকোয়েস্ট\n${label}\n(chat_id: ${chatId})\n\nAdmin panel > Bot Chats থেকে Approve করুন।`;

  await Promise.all(notifyChats.map((c) => tg('sendMessage', { chat_id: c.chat_id, text })));
}

async function getChatConfig(chatId, senderName) {
  const { data } = await supabase
    .from('telegram_bot_chats')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (data) {
    return data.is_active ? data : null;
  }

  const label = senderName ? `${senderName} (অনুমোদন অপেক্ষমান)` : 'অজানা — অনুমোদন অপেক্ষমান';

  const { error } = await supabase.from('telegram_bot_chats').insert({
    chat_id: chatId,
    label,
    purpose: 'listing_import',
    allowed_categories: null,
    is_active: false,
    notify_on_new_request: false,
  });

  if (!error) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '👋 আপনার অ্যাক্সেস রিকোয়েস্ট পাঠানো হয়েছে। অ্যাডমিন অনুমোদন করলে বট ব্যবহার করতে পারবেন।',
    });
    await notifyAdminsOfNewRequest(label, chatId);
  }

  return null;
}

function getAllowedCategories(chatConfig) {
  if (!chatConfig.allowed_categories || chatConfig.allowed_categories.length === 0) {
    return ALL_CATEGORY_IDS.filter((c) => c !== MENU_CATEGORY);
  }
  return chatConfig.allowed_categories.filter((c) => ALL_CATEGORY_IDS.includes(c));
}

async function downloadTelegramPhoto(fileId) {
  const fileInfo = await tg('getFile', { file_id: fileId });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) throw new Error('Telegram file path পাওয়া যায়নি');

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const res = await fetch(fileUrl);
  const buffer = Buffer.from(await res.arrayBuffer());
  const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  return { buffer, mimeType, base64: buffer.toString('base64') };
}

async function uploadToStorage(buffer, mimeType, path) {
  const { error } = await supabase.storage
    .from('listing-images')
    .upload(path, buffer, { contentType: mimeType, upsert: true });
  if (error) throw new Error(`Storage আপলোড ব্যর্থ: ${error.message}`);
  const { data } = supabase.storage.from('listing-images').getPublicUrl(path);
  return data.publicUrl;
}

async function getActiveSession(chatId) {
  const { data } = await supabase
    .from('screenshot_imports')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .neq('step', 'done')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

function senderDisplayName(from) {
  if (!from) return null;
  const parts = [from.first_name, from.last_name].filter(Boolean);
  const name = parts.join(' ');
  return from.username ? `${name} (@${from.username})` : name || null;
}

// ---------- ছবি হ্যান্ডলিং ----------
async function handlePhotoMessage(message) {
  const chatId = String(message.chat.id);
  const chatConfig = await getChatConfig(chatId, senderDisplayName(message.from));
  if (!chatConfig) return;

  const activeSession = await getActiveSession(chatId);
  const largestPhoto = message.photo[message.photo.length - 1];

  if (activeSession && activeSession.step === 'awaiting_extra_images' && activeSession.category === MENU_CATEGORY) {
    await handleMenuPhoto(chatId, message, activeSession, largestPhoto);
    return;
  }

  if (activeSession && activeSession.step === 'awaiting_extra_images') {
    const { buffer, mimeType } = await downloadTelegramPhoto(largestPhoto.file_id);
    const path = `screenshot-imports/${activeSession.id}-${Date.now()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
    const url = await uploadToStorage(buffer, mimeType, path);

    const updatedUrls = [...activeSession.extra_image_urls, url];
    await supabase.from('screenshot_imports').update({ extra_image_urls: updatedUrls }).eq('id', activeSession.id);

    await tg('sendMessage', {
      chat_id: chatId,
      text: `📷 ছবি যোগ হলো (মোট ${updatedUrls.length}টা)। আরও ছবি পাঠাতে পারেন, শেষ হলে ✅ চাপুন।`,
      reply_markup: {
        inline_keyboard: [[{ text: '✅ শেষ, লিস্টিং তৈরি করো', callback_data: `doneimg:${activeSession.id}` }]],
      },
    });
    return;
  }

  const allowedCategories = getAllowedCategories(chatConfig);

  const { data: row, error } = await supabase
    .from('screenshot_imports')
    .insert({
      telegram_chat_id: chatId,
      telegram_message_id: message.message_id,
      category: 'unset',
      file_id: largestPhoto.file_id,
      step: 'awaiting_category',
      submitted_via_label: chatConfig.label,
    })
    .select()
    .single();

  if (error) {
    await tg('sendMessage', { chat_id: chatId, text: `❌ সেভ করতে সমস্যা: ${error.message}` });
    return;
  }

  const buttons = [];
  for (let i = 0; i < allowedCategories.length; i += 2) {
    const rowBtns = allowedCategories.slice(i, i + 2).map((cat) => ({
      text: `${CATEGORY_EMOJIS[cat]} ${CATEGORY_LABELS[cat]}`,
      callback_data: `cat:${row.id}:${cat}`,
    }));
    buttons.push(rowBtns);
  }

  await tg('sendMessage', {
    chat_id: chatId,
    reply_to_message_id: message.message_id,
    text: 'কোন ক্যাটাগরির জন্য এই স্ক্রিনশট?',
    reply_markup: { inline_keyboard: buttons },
  });
}

// ---------- টেক্সট হ্যান্ডলিং (ক্লাবের নাম) ----------
async function handleTextMessage(message) {
  const chatId = String(message.chat.id);
  const chatConfig = await getChatConfig(chatId, senderDisplayName(message.from));
  if (!chatConfig) return;

  const session = await getActiveSession(chatId);
  if (!session || session.step !== 'awaiting_club_name') return;

  const clubNameRaw = message.text.trim();

  await tg('sendMessage', { chat_id: chatId, text: `⏳ "${clubNameRaw}" ক্লাব হিসেবে প্রসেস হচ্ছে...` });

  try {
    const { base64, mimeType } = await downloadTelegramPhoto(session.file_id);
    const extractedArray = await extractListingFromScreenshot({ imageBase64: base64, mimeType, category: 'blood' });

    const rawRows = buildBloodDonorRows(extractedArray, session.upazila, clubNameRaw).map((row) => ({
      ...row,
      submitted_via_label: session.submitted_via_label,
    }));

    const dedupedMap = new Map();
    rawRows.forEach((row) => dedupedMap.set(row.phone, row));
    let rows = Array.from(dedupedMap.values());

    const duplicateCount = rawRows.length - rows.length;
    const skipped = extractedArray.length - rawRows.length;

    if (rows.length === 0) {
      await tg('sendMessage', { chat_id: chatId, text: '❌ কোনো ভ্যালিড ফোন নম্বর সহ ডোনার পাওয়া যায়নি।' });
      await supabase.from('screenshot_imports').update({ step: 'done' }).eq('id', session.id);
      return;
    }

    const phones = rows.map((r) => r.phone);
    const { data: existingRows } = await supabase
      .from('manual_blood_donors')
      .select('phone, status')
      .in('phone', phones);

    const existingStatusMap = Object.fromEntries((existingRows || []).map((r) => [r.phone, r.status]));

    let updatedCount = 0;
    let newCount = 0;

    rows = rows.map((row) => {
      const existingStatus = existingStatusMap[row.phone];
      if (existingStatus) {
        updatedCount++;
        return { ...row, status: existingStatus };
      }
      newCount++;
      return row;
    });

    const { error } = await supabase.from('manual_blood_donors').upsert(rows, { onConflict: 'phone' });

    if (error) {
      await tg('sendMessage', { chat_id: chatId, text: `❌ সেভ করতে সমস্যা: ${error.message}` });
      return;
    }

    await supabase
      .from('screenshot_imports')
      .update({ club_name_raw: clubNameRaw, step: 'done' })
      .eq('id', session.id);

    let summary = `✅ প্রসেস সম্পন্ন হয়েছে (${session.upazila}, ${clubNameRaw})\n`;
    summary += `নতুন যোগ হয়েছে: ${newCount} জন (pending)\n`;
    if (updatedCount > 0) summary += `আগে থেকে ছিল, তথ্য আপডেট হয়েছে (status অপরিবর্তিত): ${updatedCount} জন\n`;
    if (skipped > 0) summary += `⚠️ ${skipped} জনের ফোন নম্বর পাওয়া যায়নি, বাদ পড়েছে।\n`;
    if (duplicateCount > 0) summary += `⚠️ ${duplicateCount} জনের ফোন নম্বর ডুপ্লিকেট ছিল, একটাই রাখা হয়েছে।`;

    await tg('sendMessage', { chat_id: chatId, text: summary.trim() });
  } catch (err) {
    await tg('sendMessage', { chat_id: chatId, text: `❌ প্রসেস করতে সমস্যা: ${err.message}` });
  }
}

// ---------- Callback হ্যান্ডলিং ----------

// ---------- ডেলিভারি মেনু ইম্পোর্ট ----------
// ফ্লো: ছবি → 🍽️ মেনু → দোকান বাছা → Gemini আইটেম+দাম বের করে →
// আইটেমের ছবি সিরিয়ালে (১ম ছবি = ১ম আইটেম) → ✅ শেষ → delivery_shop_items।
// নতুন আইটেম is_available=false (ড্রাফট) হিসেবে ঢোকে; "সব চালু করো" চাপলে চালু হয়।
// সিরিয়াল ছবিগুলো আলাদা রো (category='menu_photo', club_name_raw = মূল সেশনের id)
// হিসেবে সেভ হয়, যাতে একসাথে আসা ছবিতে লেখা হারায় না; telegram_message_id দিয়ে ক্রম।

async function getMenuShops() {
  const { data } = await supabase
    .from('delivery_shops')
    .select('id, name, upazila')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .limit(40);
  return data || [];
}

function removeMenuImage(url) {
  if (typeof url !== 'string') return;
  const parts = url.split('/' + MENU_BUCKET + '/');
  if (parts.length < 2) return;
  let path;
  try {
    path = decodeURIComponent(parts[1].split('?')[0]);
  } catch (e) {
    return;
  }
  // ছবি রয়ে গেলেও ক্ষতি নেই, তাই ব্যর্থ হলে চুপচাপ
  supabase.storage.from(MENU_BUCKET).remove([path]).catch(() => {});
}

async function handleMenuCategorySelected(chatId, messageId, importId, chatConfig) {
  if (!getAllowedCategories(chatConfig).includes(MENU_CATEGORY)) {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: '❌ এই চ্যাটে মেনু ইম্পোর্টের অনুমতি নেই।',
    });
    return;
  }

  const shops = await getMenuShops();
  if (shops.length === 0) {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: '❌ কোনো দোকান নেই। আগে অ্যাডমিন প্যানেলের "ডেলিভারি দোকান" পেজ থেকে দোকান যোগ করুন।',
    });
    return;
  }

  await supabase
    .from('screenshot_imports')
    .update({ category: MENU_CATEGORY, step: 'awaiting_shop' })
    .eq('id', importId)
    .eq('telegram_chat_id', chatId);

  const buttons = shops.map((s) => [
    { text: s.upazila ? `${s.name} · ${s.upazila}` : s.name, callback_data: `shp:${importId}:${s.id.slice(0, 8)}` },
  ]);

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `${CATEGORY_EMOJIS[MENU_CATEGORY]} ${CATEGORY_LABELS[MENU_CATEGORY]} ✅\n\nকোন দোকানের মেনু?`,
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleShopSelected(chatId, messageId, importId, shopPrefix) {
  const { data: row } = await supabase
    .from('screenshot_imports')
    .select('*')
    .eq('id', importId)
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (!row || row.category !== MENU_CATEGORY || row.step !== 'awaiting_shop') {
    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: '❌ এই অনুরোধটা আর চালু নেই। স্ক্রিনশট আবার পাঠান।' });
    return;
  }

  const shops = await getMenuShops();
  const shop = shops.find((s) => s.id.startsWith(String(shopPrefix || '')));
  if (!shop) {
    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: '❌ দোকান পাওয়া যায়নি। স্ক্রিনশট আবার পাঠান।' });
    return;
  }

  // দুবার চাপলে একবারই চলবে
  const { data: claimed } = await supabase
    .from('screenshot_imports')
    .update({ step: 'processing', upazila: shop.name })
    .eq('id', importId)
    .eq('step', 'awaiting_shop')
    .select('id');
  if (!claimed || claimed.length === 0) return;

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `দোকান: ${shop.name} ✅\n\n⏳ মেনু পড়া হচ্ছে...`,
  });

  try {
    const { base64, mimeType } = await downloadTelegramPhoto(row.file_id);
    const raw = await extractListingFromScreenshot({ imageBase64: base64, mimeType, category: MENU_CATEGORY });
    const items = normalizeMenuItems(raw);

    if (items.length === 0) {
      await supabase.from('screenshot_imports').update({ step: 'done' }).eq('id', importId);
      await tg('editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: '❌ স্ক্রিনশট থেকে কোনো আইটেম ও দাম পাওয়া যায়নি। পরিষ্কার স্ক্রিনশট দিয়ে আবার চেষ্টা করুন।',
      });
      return;
    }

    await supabase
      .from('screenshot_imports')
      .update({ extracted: { shop_id: shop.id, shop_name: shop.name, items }, step: 'awaiting_extra_images' })
      .eq('id', importId);

    const shown = items.slice(0, 40).map((it, i) => `${i + 1}. ${it.name} — ৳${it.price}`).join('\n');
    const more = items.length > 40 ? `\n… আরও ${items.length - 40}টি` : '';

    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text:
        `✅ ${shop.name}: ${items.length}টি আইটেম পাওয়া গেছে\n\n${shown}${more}\n\n` +
        `এবার আইটেমগুলোর ছবি এই ক্রমে একটা একটা করে ফোটো হিসেবে পাঠান (১ম ছবি = ১ নম্বর আইটেম, ২য় ছবি = ২ নম্বর...)। ` +
        `ছবি ছাড়া চাইলে সরাসরি ✅ চাপুন। দাম বা নাম ভুল হলে পরে অ্যাডমিন পেজে ঠিক করা যাবে।`,
      reply_markup: { inline_keyboard: [[{ text: '✅ শেষ, মেনুতে যোগ করো', callback_data: `doneimg:${importId}` }]] },
    });
  } catch (err) {
    await supabase.from('screenshot_imports').update({ step: 'done' }).eq('id', importId);
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `❌ প্রসেস করতে সমস্যা: ${err.message}\n\nস্ক্রিনশট আবার পাঠিয়ে চেষ্টা করুন।`,
    });
  }
}

async function handleMenuPhoto(chatId, message, session, photo) {
  const shopId = session.extracted?.shop_id;
  const expected = session.extracted?.items?.length || 0;
  let uploadedPath = null;

  try {
    if (!shopId) throw new Error('দোকান পাওয়া যায়নি');

    const { buffer, mimeType } = await downloadTelegramPhoto(photo.file_id);
    if (buffer.length > MENU_MAX_BYTES) throw new Error('ছবি ৩MB-এর বেশি, ছোট ছবি দিন');

    uploadedPath = `items/${shopId}/${randomUUID()}.${mimeType === 'image/png' ? 'png' : 'jpg'}`;
    const { error: upErr } = await supabase.storage
      .from(MENU_BUCKET)
      .upload(uploadedPath, buffer, { contentType: mimeType, cacheControl: '31536000', upsert: false });
    if (upErr) throw new Error(`Storage আপলোড ব্যর্থ: ${upErr.message}`);

    const imageUrl = supabase.storage.from(MENU_BUCKET).getPublicUrl(uploadedPath).data.publicUrl;

    const { error } = await supabase.from('screenshot_imports').insert({
      telegram_chat_id: chatId,
      telegram_message_id: message.message_id,
      category: 'menu_photo',
      file_id: photo.file_id,
      image_url: imageUrl,
      step: 'done',
      club_name_raw: session.id,
      submitted_via_label: session.submitted_via_label,
    });
    if (error) throw new Error(`সেভ ব্যর্থ: ${error.message}`);
    uploadedPath = null;

    const { count } = await supabase
      .from('screenshot_imports')
      .select('id', { count: 'exact', head: true })
      .eq('category', 'menu_photo')
      .eq('club_name_raw', session.id);
    const total = count || 0;
    const warn = total > expected ? `\n⚠️ আইটেম ${expected}টা, ছবি ${total}টা। বাড়তি ছবি বাদ যাবে।` : '';

    await tg('sendMessage', {
      chat_id: chatId,
      text: `📷 ছবি পেয়েছি (ছবি ${total}টা, আইটেম ${expected}টা)।${warn}\nআরও পাঠান, শেষ হলে ✅ চাপুন।`,
      reply_markup: { inline_keyboard: [[{ text: '✅ শেষ, মেনুতে যোগ করো', callback_data: `doneimg:${session.id}` }]] },
    });
  } catch (err) {
    if (uploadedPath) supabase.storage.from(MENU_BUCKET).remove([uploadedPath]).catch(() => {});
    await tg('sendMessage', {
      chat_id: chatId,
      text: `❌ এই ছবিটা যোগ করা যায়নি: ${err.message}\nআবার পাঠান।`,
    });
  }
}

async function handleMenuDone(chatId, messageId, importId) {
  // একবারই চলবে (দুবার চাপলে বা দুই ট্যাপে ডুপ্লিকেট আইটেম যেন না হয়)
  const { data: row } = await supabase
    .from('screenshot_imports')
    .update({ step: 'processing' })
    .eq('id', importId)
    .eq('telegram_chat_id', chatId)
    .eq('step', 'awaiting_extra_images')
    .select('*')
    .maybeSingle();
  if (!row) return;

  const { shop_id: shopId, shop_name: shopName, items } = row.extracted || {};

  try {
    if (!shopId || !Array.isArray(items) || items.length === 0) throw new Error('ডেটা পাওয়া যায়নি');

    const { data: photos, error: phErr } = await supabase
      .from('screenshot_imports')
      .select('image_url, telegram_message_id')
      .eq('category', 'menu_photo')
      .eq('club_name_raw', importId)
      .order('telegram_message_id', { ascending: true });
    if (phErr) throw phErr;
    const photoUrls = (photos || []).map((p) => p.image_url).filter(Boolean);

    const { data: existing, error: exErr } = await supabase
      .from('delivery_shop_items')
      .select('id, name, price, image_url, sort_order')
      .eq('shop_id', shopId);
    if (exErr) throw exErr;

    const norm = (s) => String(s).normalize('NFC').trim().toLowerCase();
    const existingByName = new Map((existing || []).map((e) => [norm(e.name), e]));
    let nextSort = Math.max(0, ...(existing || []).map((e) => e.sort_order || 0));

    const toInsert = [];
    const priceChanges = [];
    let unchanged = 0;

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const imageUrl = photoUrls[i] || null;
      const ex = existingByName.get(norm(it.name));

      if (ex) {
        // আগে থেকে থাকা আইটেম: শুধু দাম/ছবি আপডেট, চালু-বন্ধ অবস্থা অপরিবর্তিত
        const patch = {};
        if (Number(ex.price) !== it.price) patch.price = it.price;
        if (imageUrl) patch.image_url = imageUrl;
        if (Object.keys(patch).length === 0) {
          unchanged++;
          continue;
        }
        const { error } = await supabase.from('delivery_shop_items').update(patch).eq('id', ex.id);
        if (error) throw error;
        if (patch.price !== undefined) priceChanges.push(`${it.name}: ৳${Number(ex.price)} → ৳${it.price}`);
        if (patch.image_url && ex.image_url) removeMenuImage(ex.image_url);
        continue;
      }

      nextSort += 10;
      toInsert.push({
        shop_id: shopId,
        name: it.name,
        price: it.price,
        image_url: imageUrl,
        is_available: false,
        sort_order: nextSort,
      });
    }

    let createdIds = [];
    if (toInsert.length > 0) {
      const { data: inserted, error } = await supabase.from('delivery_shop_items').insert(toInsert).select('id');
      if (error) throw error;
      createdIds = (inserted || []).map((r) => r.id);
    }

    await supabase
      .from('screenshot_imports')
      .update({ step: 'done', extracted: { ...row.extracted, created_item_ids: createdIds } })
      .eq('id', importId);

    const placed = Math.min(photoUrls.length, items.length);
    let summary = `✅ ${shopName}-এর মেনু আপডেট হয়েছে\n`;
    summary += `নতুন আইটেম (এখন বন্ধ, কাস্টমার দেখবে না): ${createdIds.length}টি\n`;
    if (priceChanges.length > 0) {
      summary += `দাম বদলেছে (এগুলো সরাসরি কার্যকর): ${priceChanges.length}টি\n${priceChanges.slice(0, 15).join('\n')}\n`;
    }
    if (unchanged > 0) summary += `অপরিবর্তিত: ${unchanged}টি\n`;
    summary += `ছবি বসেছে: ${placed}/${items.length}টি আইটেমে\n`;
    if (photoUrls.length > items.length) summary += `⚠️ ${photoUrls.length - items.length}টা বাড়তি ছবি বাদ গেছে।\n`;
    summary += `\nনাম, দাম, ছবি ভুল থাকলে অ্যাডমিন প্যানেলের "ডেলিভারি দোকান" পেজে ঠিক করুন। ঠিক থাকলে নিচের বাটনে চালু করুন।`;

    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: summary,
      ...(createdIds.length > 0
        ? { reply_markup: { inline_keyboard: [[{ text: `✅ নতুন ${createdIds.length}টি সব চালু করো`, callback_data: `enable:${importId}` }]] } }
        : {}),
    });
  } catch (err) {
    // আবার "শেষ" চাপা যাবে; আগে থাকা আইটেম নাম মিলিয়ে ধরা হবে, ডুপ্লিকেট হবে না
    await supabase.from('screenshot_imports').update({ step: 'awaiting_extra_images' }).eq('id', importId);
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `❌ মেনুতে যোগ করতে সমস্যা: ${err.message}`,
      reply_markup: { inline_keyboard: [[{ text: '🔁 আবার চেষ্টা করো', callback_data: `doneimg:${importId}` }]] },
    });
  }
}

async function handleMenuEnable(chatId, messageId, importId) {
  const { data: row } = await supabase
    .from('screenshot_imports')
    .select('*')
    .eq('id', importId)
    .eq('telegram_chat_id', chatId)
    .eq('category', MENU_CATEGORY)
    .maybeSingle();

  const ids = row?.extracted?.created_item_ids;
  if (!Array.isArray(ids) || ids.length === 0) {
    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: '❌ চালু করার মতো নতুন আইটেম নেই।' });
    return;
  }

  const { error } = await supabase.from('delivery_shop_items').update({ is_available: true }).in('id', ids);
  if (error) {
    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: `❌ চালু করা যায়নি: ${error.message}` });
    return;
  }

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `✅ ${ids.length}টি আইটেম চালু হয়েছে। কাস্টমার এখন ${row.extracted.shop_name}-এর মেনু দেখতে পাবে।`,
  });
}

async function handleCategorySelected(chatId, messageId, importId, category, chatConfig) {
  if (category === MENU_CATEGORY) {
    await handleMenuCategorySelected(chatId, messageId, importId, chatConfig);
    return;
  }

  await supabase.from('screenshot_imports').update({ category, step: 'awaiting_upazila' }).eq('id', importId);

  const buttons = UPAZILA_LIST.map((name, i) => [{ text: name, callback_data: `upa:${importId}:${i}` }]);
  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `${CATEGORY_LABELS[category]} ✅\n\nকোন উপজিলার জন্য এই স্ক্রিনশট?`,
    reply_markup: { inline_keyboard: buttons },
  });
}

async function handleUpazilaSelected(chatId, messageId, importId, upazilaIndex) {
  const upazila = UPAZILA_LIST[Number(upazilaIndex)];
  await supabase.from('screenshot_imports').update({ upazila }).eq('id', importId);

  const { data: row } = await supabase.from('screenshot_imports').select('*').eq('id', importId).single();
  if (!row) return;

  if (row.category === 'blood') {
    await supabase.from('screenshot_imports').update({ step: 'awaiting_club_name' }).eq('id', importId);
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `উপজিলা: ${upazila} ✅\n\nকোন ক্লাব থেকে এই লিস্ট, নাম লিখে reply করুন।`,
    });
    return;
  }

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `উপজিলা: ${upazila} ✅\n\n⏳ ${CATEGORY_LABELS[row.category]} হিসেবে প্রসেস হচ্ছে...`,
  });

  try {
    const { base64, mimeType } = await downloadTelegramPhoto(row.file_id);
    const extracted = await extractListingFromScreenshot({ imageBase64: base64, mimeType, category: row.category });

    await supabase
      .from('screenshot_imports')
      .update({ extracted, step: 'awaiting_extra_images' })
      .eq('id', importId);

    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `✅ তথ্য বের করা হয়েছে:\n${extracted.title}\n\nএবার আসল ছবি পাঠান (একাধিক পাঠাতে পারবেন), শেষ হলে ✅ বাটনে চাপুন।`,
      reply_markup: { inline_keyboard: [[{ text: '✅ শেষ, লিস্টিং তৈরি করো', callback_data: `doneimg:${importId}` }]] },
    });
  } catch (err) {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `❌ প্রসেস করতে সমস্যা: ${err.message}`,
    });
  }
}

async function handleDoneImages(chatId, messageId, importId) {
  const { data: kindRow } = await supabase.from('screenshot_imports').select('category').eq('id', importId).maybeSingle();
  if (kindRow?.category === MENU_CATEGORY) {
    await handleMenuDone(chatId, messageId, importId);
    return;
  }

  const { data: row } = await supabase.from('screenshot_imports').select('*').eq('id', importId).single();
  if (!row || !row.extracted) {
    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: '❌ ডেটা পাওয়া যায়নি' });
    return;
  }

  const listingRow = buildListingRowFromExtraction(row.extracted, row.category, row.upazila, row.extra_image_urls);
  listingRow.submitted_via_label = row.submitted_via_label;

  const { error } = await supabase.from('listings').insert(listingRow);

  if (error) {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `❌ লিস্টিং সেভ করতে সমস্যা: ${error.message}`,
    });
    return;
  }

  await supabase.from('screenshot_imports').update({ step: 'done' }).eq('id', importId);

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `✅ লিস্টিং pending-এ যোগ হয়েছে! (${CATEGORY_LABELS[row.category]}, ${row.upazila}, ${row.extra_image_urls.length}টা ছবি সহ)`,
  });
}

export async function POST({ request }) {
  if (WEBHOOK_SECRET && request.headers.get('x-telegram-bot-api-secret-token') !== WEBHOOK_SECRET) {
    return new Response('forbidden', { status: 403 });
  }

  const update = await request.json();

  try {
    if (update.message?.photo) {
      await handlePhotoMessage(update.message);
    } else if (update.message?.text) {
      await handleTextMessage(update.message);
    } else if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message.chat.id);
      const messageId = cq.message.message_id;

      await tg('answerCallbackQuery', { callback_query_id: cq.id });

      const chatConfig = await getChatConfig(chatId, senderDisplayName(cq.from));
      if (chatConfig) {
        const [action, importId, extra] = cq.data.split(':');

        if (action === 'cat') await handleCategorySelected(chatId, messageId, importId, extra, chatConfig);
        else if (action === 'shp') await handleShopSelected(chatId, messageId, importId, extra);
        else if (action === 'enable') await handleMenuEnable(chatId, messageId, importId);
        else if (action === 'upa') await handleUpazilaSelected(chatId, messageId, importId, extra);
        else if (action === 'doneimg') await handleDoneImages(chatId, messageId, importId);
      }
    }
  } catch (err) {
    console.error('telegram-webhook error:', err);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}