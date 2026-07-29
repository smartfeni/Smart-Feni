// ============================================================
// Telegram Webhook — স্ক্রিনশট থেকে লিস্টিং ইম্পোর্ট
//
// ফ্লো:
// ১. Admin ছবি পাঠায় -> বট ৩টা ক্যাটাগরি বাটন দেখায়
// ২. ক্যাটাগরি সিলেক্ট করলে -> Gemini extraction চলে, ছবি
//    Supabase Storage-এ আপলোড হয়, ফলাফল বাংলায় দেখানো হয়
//    Approve/Reject বাটন সহ
// ৩. Approve চাপলে -> `listings` টেবিলে insert (status: active)
// ৪. Reject চাপলে -> বাতিল, কিছু insert হয় না
//
// এনভায়রনমেন্ট ভ্যারিয়েবল লাগবে:
// TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, GEMINI_API_KEY,
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { extractListingFromScreenshot, buildListingRowFromExtraction } from '../../lib/geminiExtract.js';

export const prerender = false;

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID);
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CATEGORY_LABELS = {
  housing: 'বাসা ভাড়া',
  blood: 'ব্লাড ডোনার',
  recycle: 'ক্রয়-বিক্রয়',
};

async function tg(method, body) {
  const res = await fetch(`${TELEGRAM_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json();
}

// Telegram file_id দিয়ে ছবি ডাউনলোড করে base64 এ রূপান্তর করে
async function downloadTelegramPhotoAsBase64(fileId) {
  const fileInfo = await tg('getFile', { file_id: fileId });
  const filePath = fileInfo?.result?.file_path;
  if (!filePath) throw new Error('Telegram file path পাওয়া যায়নি');

  const fileUrl = `https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`;
  const res = await fetch(fileUrl);
  const buffer = await res.arrayBuffer();
  const base64 = Buffer.from(buffer).toString('base64');
  const mimeType = filePath.endsWith('.png') ? 'image/png' : 'image/jpeg';

  return { base64, mimeType, buffer: Buffer.from(buffer) };
}

// এক্সট্র্যাক্ট হওয়া ডেটা বাংলায় সামারি টেক্সট বানায়
function formatSummary(category, extracted) {
  const label = CATEGORY_LABELS[category];
  if (category === 'housing') {
    return (
      `📋 *${label}* — রিভিউ করুন\n\n` +
      `শিরোনাম: ${extracted.title}\n` +
      `ধরন: ${extracted.rent_type}\n` +
      `ভাড়া: ${extracted.price || 'উল্লেখ নাই'}\n` +
      `এলাকা: ${extracted.area || 'উল্লেখ নাই'}\n` +
      `ফোন: ${extracted.phone || 'উল্লেখ নাই'}\n` +
      `বিবরণ: ${extracted.description}`
    );
  }
  if (category === 'blood') {
    return (
      `📋 *${label}* — রিভিউ করুন\n\n` +
      `নাম: ${extracted.name}\n` +
      `ব্লাড গ্রুপ: ${extracted.blood_group}\n` +
      `এলাকা: ${extracted.area || 'উল্লেখ নাই'}\n` +
      `ফোন: ${extracted.phone || 'উল্লেখ নাই'}`
    );
  }
  if (category === 'recycle') {
    return (
      `📋 *${label}* — রিভিউ করুন\n\n` +
      `আইটেম: ${extracted.title}\n` +
      `কন্ডিশন: ${extracted.condition}\n` +
      `দাম: ${extracted.price || 'উল্লেখ নাই'}\n` +
      `এলাকা: ${extracted.area || 'উল্লেখ নাই'}\n` +
      `ফোন: ${extracted.phone || 'উল্লেখ নাই'}\n` +
      `বিবরণ: ${extracted.description}`
    );
  }
  return 'অজানা ক্যাটাগরি';
}

async function handlePhotoMessage(message) {
  const chatId = String(message.chat.id);
  if (chatId !== ADMIN_CHAT_ID) return; // শুধু admin চ্যাট থেকে গ্রহণ করবে

  // সবচেয়ে বড় সাইজের ছবিটা নেওয়া (photo array ছোট->বড় সাজানো থাকে)
  const largestPhoto = message.photo[message.photo.length - 1];

  const { data: row, error } = await supabase
    .from('screenshot_imports')
    .insert({
      telegram_chat_id: chatId,
      telegram_message_id: message.message_id,
      category: 'unset',
      file_id: largestPhoto.file_id,
      status: 'awaiting_category',
    })
    .select()
    .single();

  if (error) {
    await tg('sendMessage', { chat_id: chatId, text: `❌ সেভ করতে সমস্যা: ${error.message}` });
    return;
  }

  await tg('sendMessage', {
    chat_id: chatId,
    reply_to_message_id: message.message_id,
    text: 'কোন ক্যাটাগরির জন্য এই স্ক্রিনশট?',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '🏠 বাসা ভাড়া', callback_data: `cat:${row.id}:housing` },
          { text: '🩸 ব্লাড ডোনার', callback_data: `cat:${row.id}:blood` },
        ],
        [{ text: '♻️ ক্রয়-বিক্রয়', callback_data: `cat:${row.id}:recycle` }],
      ],
    },
  });
}

async function handleCategorySelected(callbackQuery, importId, category) {
  const chatId = String(callbackQuery.message.chat.id);
  const messageId = callbackQuery.message.message_id;

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `⏳ ${CATEGORY_LABELS[category]} হিসেবে প্রসেস হচ্ছে...`,
  });

  const { data: row } = await supabase
    .from('screenshot_imports')
    .select('*')
    .eq('id', importId)
    .single();

  if (!row) {
    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: '❌ এন্ট্রি খুঁজে পাওয়া যায়নি' });
    return;
  }

  try {
    const { base64, mimeType, buffer } = await downloadTelegramPhotoAsBase64(row.file_id);

    // Gemini দিয়ে extraction
    const extracted = await extractListingFromScreenshot({ imageBase64: base64, mimeType, category });

    // Supabase Storage এ আপলোড
    const fileExt = mimeType === 'image/png' ? 'png' : 'jpg';
    const storagePath = `screenshot-imports/${row.id}.${fileExt}`;
    const { error: uploadError } = await supabase.storage
      .from('listing-images')
      .upload(storagePath, buffer, { contentType: mimeType, upsert: true });

    if (uploadError) throw new Error(`Storage আপলোড ব্যর্থ: ${uploadError.message}`);

    const { data: publicUrlData } = supabase.storage.from('listing-images').getPublicUrl(storagePath);
    const imageUrl = publicUrlData.publicUrl;

    await supabase
      .from('screenshot_imports')
      .update({ category, extracted, image_url: imageUrl, status: 'awaiting_approval' })
      .eq('id', importId);

    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: formatSummary(category, extracted),
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve', callback_data: `approve:${importId}` },
            { text: '❌ Reject', callback_data: `reject:${importId}` },
          ],
        ],
      },
    });
  } catch (err) {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `❌ প্রসেস করতে সমস্যা হয়েছে:\n${err.message}`,
    });
  }
}

async function handleApprove(callbackQuery, importId) {
  const chatId = String(callbackQuery.message.chat.id);
  const messageId = callbackQuery.message.message_id;

  const { data: row } = await supabase
    .from('screenshot_imports')
    .select('*')
    .eq('id', importId)
    .single();

  if (!row || !row.extracted) {
    await tg('editMessageText', { chat_id: chatId, message_id: messageId, text: '❌ ডেটা পাওয়া যায়নি' });
    return;
  }

  const listingRow = buildListingRowFromExtraction(row.extracted, row.category, row.image_url);
  listingRow.status = 'active'; // admin approve করেছে, তাই সরাসরি লাইভ

  const { error } = await supabase.from('listings').insert(listingRow);

  if (error) {
    await tg('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `❌ লিস্টিং সেভ করতে সমস্যা: ${error.message}`,
    });
    return;
  }

  await supabase.from('screenshot_imports').update({ status: 'approved' }).eq('id', importId);

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: `✅ লিস্টিং সাইটে যোগ হয়েছে! (${CATEGORY_LABELS[row.category]})`,
  });
}

async function handleReject(callbackQuery, importId) {
  const chatId = String(callbackQuery.message.chat.id);
  const messageId = callbackQuery.message.message_id;

  await supabase.from('screenshot_imports').update({ status: 'rejected' }).eq('id', importId);

  await tg('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text: '🗑️ বাতিল করা হয়েছে, কিছু সেভ হয়নি।',
  });
}

export async function POST({ request }) {
  const update = await request.json();

  try {
    if (update.message?.photo) {
      await handlePhotoMessage(update.message);
    } else if (update.callback_query) {
      const cq = update.callback_query;
      const chatId = String(cq.message.chat.id);

      // অ্যাডমিন চ্যাট ছাড়া কোনো callback প্রসেস হবে না
      if (chatId === ADMIN_CHAT_ID) {
        const [action, importId, category] = cq.data.split(':');
        await tg('answerCallbackQuery', { callback_query_id: cq.id });

        if (action === 'cat') {
          await handleCategorySelected(cq, importId, category);
        } else if (action === 'approve') {
          await handleApprove(cq, importId);
        } else if (action === 'reject') {
          await handleReject(cq, importId);
        }
      } else {
        await tg('answerCallbackQuery', { callback_query_id: cq.id });
      }
    }
  } catch (err) {
    console.error('telegram-webhook error:', err);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}