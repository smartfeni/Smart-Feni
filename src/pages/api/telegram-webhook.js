// ---------- টেক্সট হ্যান্ডলিং (ক্লাবের নাম) ----------
async function handleTextMessage(message) {
  const chatId = String(message.chat.id);
  const chatConfig = await getChatConfig(chatId);
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

    // ============================================================
    // আগে থেকেই এই ফোন নম্বরগুলা টেবিলে থাকলে তাদের status প্রিজার্ভ
    // করা হচ্ছে — নাহলে re-upload করলে already active ডোনার আবার
    // pending হয়ে ব্লাড পেজ থেকে হারিয়ে যেত (upsert পুরো row
    // ওভাররাইট করে ফেলত)
    // ============================================================
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
        return { ...row, status: existingStatus }; // পুরনো status প্রিজার্ভ
      }
      newCount++;
      return row; // নতুন এন্ট্রি, status: 'pending' থাকবে (buildBloodDonorRows থেকে আসা)
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