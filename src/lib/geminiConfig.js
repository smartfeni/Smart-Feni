// src/lib/geminiConfig.js
// Gemini মডেলের নাম এক জায়গায় — মডেল পুরনো/বন্ধ হলে শুধু এই ফাইলে বদলান।
// ব্যবহার: api/chat.ts, api/doctor-chat.ts
// (src/lib/geminiExtract.js নিজের GEMINI_MODEL env দিয়ে চলে, সেটা আলাদা — চাইলে পরে এখান থেকে নেওয়া যাবে)

export const GEMINI_MODEL = 'gemini-3.1-flash-lite';

// ব্যাকআপ মডেল (ঐচ্ছিক): মূল মডেল 503/টাইমআউট দিলে ২য় চেষ্টায় এটা ব্যবহার হয়।
// Vercel env GEMINI_FALLBACK_MODEL বসালে সেই মডেল; না বসালে ২য় চেষ্টা একই মডেলেই হয়।
export const GEMINI_FALLBACK_MODEL = (import.meta.env.GEMINI_FALLBACK_MODEL || '').trim() || undefined;

// model না দিলে মূল মডেল
export function geminiUrl(apiKey, model) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model || GEMINI_MODEL}:generateContent?key=${apiKey}`;
}