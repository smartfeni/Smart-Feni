// ============================================================
// Telegram Webhook — স্ক্রিনশট থেকে লিস্টিং ইম্পোর্ট (multi-step)
// + মাল্টি-চ্যাট সাপোর্ট: single ADMIN_CHAT_ID এর বদলে
// `telegram_bot_chats` টেবিল থেকে অনুমোদিত চ্যাট লিস্ট চেক হয়
// (moderator-দের নিজস্ব চ্যাট + category-ভিত্তিক ডেডিকেটেড চ্যাট,
// কোড ডিপ্লয় ছাড়াই নতুন চ্যাট যোগ করা যায়)
//
// অনুমোদিত না এমন চ্যাট থেকে মেসেজ এলে অটো-ডিটেক্ট করে pending
// row হিসেবে সেভ হয় (is_active: false) — Admin panel এ
// /admin/bot-chats পেজে দেখা যাবে, সেখান থেকে Activate করলেই কাজ শুরু
//
// সব ক্যাটাগরির কমন ফ্লো: ছবি -> ক্যাটাগরি বাটন (allowed_categories
//   অনুযায়ী ফিল্টার হতে পারে) -> উপজিলা বাটন
//   housing/recycle: -> extraction -> আসল ছবি (একাধিক) -> ✅ শেষ -> listings insert (status: pending)
//   blood: -> ক্লাব নাম (টেক্সট রিপ্লাই) -> extraction (array) -> manual_blood_donors bulk insert
//   (আগে থেকে থাকা ফোন নম্বরের status প্রিজার্ভ হয়)
//
// প্রতিটা এন্ট্রিতে submitted_via_label সেভ হয় (accountability)
//
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে:
// TELEGRAM_BOT_TOKEN, GEMINI_API_KEY,
// PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from '@supabase/supabase-js';
import {
  extractListingFromScreenshot,
  buildListingRowFromExtraction,
  buildBloodDonorRows,
} from '../../lib/geminiExtract.js';

export const prerender = false;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const supabase = createClient(process.env.PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CATEGORY_LABELS = { housing: 'বাসা ভাড়া', blood: 'ব্লাড ডোনার', recycle: 'ক্রয়-বিক্রয়' };
const CATEGORY_EMOJIS = { housing: '🏠', blood: '🩸', recycle: '♻️' };

const UPAZILA_LIST = ['ফেনী সদর', 'ছাগলনাইয়া', 'দাগনভূঞা', 'পরশুরাম', 'ফুলগাজী', 'সোনাগাজী'];

async function tg(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// চ্যাট আইডি টেবিলে অনুমোদিত+active আছে কিনা চেক করে, থাকলে config রিটার্ন করে।
// না থাকলে একটা pending row অটো-তৈরি করে (Admin panel এ দেখা যাবে) এবং
// প্রেরককে একটা তথ্যমূলক মেসেজ পাঠায় — কিন্তু একই চ্যাট থেকে বারবার
// মেসেজ এলে বারবার pending row তৈরি না হয়ে যায় সেটা নিশ্চিত করা হয়
async function getChatConfig(chatId, senderName) {
  const { data } = await supabase
    .from('telegram_bot_chats')
    .select('*')
    .eq('chat_id', chatId)
    .maybeSingle();

  if (data) {
    return data.is_active ? data : null;
  }

  // এই চ্যাট আগে কখনো দেখা যায়নি — pending row তৈরি করা হচ্ছে
  const { error } = await supabase.from('telegram_bot_chats').insert({
    chat_id: chatId,
    label: senderName ? `${senderName} (অনুমোদন অপেক্ষমান)` : 'অজানা — অনুমোদন অপেক্ষমান',
    purpose: 'listing_import',
    allowed_categories: null,
    is_active: false,
  });

  if (!error) {
    await tg('sendMessage', {
      chat_id: chatId,
      text: '👋 আপনার অ্যাক্সেস রিকোয়েস্ট পাঠানো হয়েছে। অ্যাডমিন অনুমোদন করলে বট ব্যবহার করতে পারবেন।',
    });
  }

  return null;
}

function getAllowedCategories(chatConfig) {
  if (!chatConfig.allowed_categories || chatConfig.allowed_categories.length === 0) {
    return ['housing', 'blood', 'recycle'];
  }
  return chatConfig.allowed_categories;
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

// এই চ্যাটের সবচেয়ে সাম্প্রতিক 'চলমান' সেশন খুঁজে বের করে
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
  if (!chatConfig) return; // অনুমোদিত না বা inactive — চুপচাপ ইগনোর

  const activeSession = await getActiveSession(chatId);
  const largestPhoto = message.photo[message.photo.length - 1];

  // housing/recycle "আসল ছবি" ধাপে থাকলে, নতুন সেশন না বানিয়ে
  // এই ছবিটা extra_image_urls এ যোগ হবে
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

  // নতুন সেশন শুরু (FB পোস্টের স্ক্রিনশট)
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
  if (!session || session.step !== 'awaiting_club_name') return; // অন্য সাধারণ মেসেজ, ইগনোর

  const clubNameRaw = message.text.trim();

  await tg('sendMessage', { chat_id: chatId, text: `⏳ "${clubNameRaw}" ক্লাব হিসেবে প্রসেস হচ্ছে...` });

  try {
    const { base64, mimeType } = await downloadTelegramPhoto(session.file_id);
    const extractedArray = await extractListingFromScreenshot({ imageBase64: base64, mimeType, category: 'blood' });

    const rawRows = buildBloodDonorRows(extractedArray, session.upazila, clubNameRaw).map((row) => ({
      ...row,
      submitted_via_label: session.submitted_via_label,
    }));

    // একই ব্যাচে ফোন নম্বর ডুপ্লিকেট থাকলে upsert ব্যর্থ হয়
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

    // আগে থেকে থাকা ফোন নম্বরগুলার status প্রিজার্ভ করা হচ্ছে
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

async function handleCategorySelected(chatId, messageId, importId, category) {
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

        if (action === 'cat') await handleCategorySelected(chatId, messageId, importId, extra);
        else if (action === 'upa') await handleUpazilaSelected(chatId, messageId, importId, extra);
        else if (action === 'doneimg') await handleDoneImages(chatId, messageId, importId);
      }
    }
  } catch (err) {
    console.error('telegram-webhook error:', err);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}