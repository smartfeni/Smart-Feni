// src/lib/groqFallback.js
// Gemini ২ চেষ্টাতেও ব্যর্থ হলে ৩য় চেষ্টা হিসেবে Groq (OpenAI-compatible API)।
// ব্যবহার: api/chat.ts, api/doctor-chat.ts, api/admin/parse-manual-order.ts
// env: GROQ_API_KEY (Vercel, PUBLIC_ ছাড়া)। না থাকলে এই ফাইল কিছুই করে না (groqEnabled() = false)।
// ঐচ্ছিক env: GROQ_MODEL (ডিফল্ট openai/gpt-oss-120b; llama-3.3-70b-versatile ১৬ আগস্ট ২০২৬ বন্ধ হয়েছে) — মডেল বন্ধ হলে শুধু env বদলান।
// প্রাইভেসি: রেসপন্সের বডি বা ইউজারের লেখা কখনো লগ হয় না; শুধু স্ট্যাটাস/কারণ ফেরত যায়।
// নোট: এখানে টুল-কল নেই। অর্ডার-টুল (propose_manual_order) শুধু Gemini-তে চলে।

export const GROQ_MODEL = (import.meta.env.GROQ_MODEL || '').trim() || 'openai/gpt-oss-120b';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// gpt-oss রিজনিং মডেল: ভাবনার টোকেনও max_tokens-এ গোনা হয়, তাই কম রিজনিং ও বেশি সীমা
const isGptOss = GROQ_MODEL.startsWith('openai/gpt-oss');

export function groqEnabled() {
  return !!String(import.meta.env.GROQ_API_KEY || '').trim();
}

// messages: [{ role: 'user' | 'assistant', content: string }]
// ফেরত: { ok, status, text, error } — কখনো throw করে না
export async function groqChat({ system, messages, json = false, maxTokens = 1024, temperature = 0.3, timeoutMs = 8000 }) {
  const key = String(import.meta.env.GROQ_API_KEY || '').trim();
  if (!key) return { ok: false, status: 0, text: '', error: 'no_key' };

  try {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'system', content: system }, ...messages],
        temperature,
        max_tokens: isGptOss ? Math.max(maxTokens, 2048) : maxTokens,
        ...(isGptOss ? { reasoning_effort: 'low' } : {}),
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });

    if (!res.ok) return { ok: false, status: res.status, text: '', error: `http_${res.status}` };

    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || '').trim();
    return { ok: !!text, status: 200, text, error: text ? '' : 'empty' };
  } catch (e) {
    return { ok: false, status: 0, text: '', error: String((e && e.name) || 'Error') };
  }
}
