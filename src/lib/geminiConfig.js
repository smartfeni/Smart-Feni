// src/lib/geminiConfig.js
// Gemini মডেলের নাম এক জায়গায় — মডেল পুরনো/বন্ধ হলে শুধু এই ফাইলে বদলান।
// ব্যবহার: api/chat.ts, api/doctor-chat.ts
// (src/lib/geminiExtract.js নিজের GEMINI_MODEL env দিয়ে চলে, সেটা আলাদা — চাইলে পরে এখান থেকে নেওয়া যাবে)

export const GEMINI_MODEL = 'gemini-3.1-flash-lite';

export function geminiUrl(apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}