// src/pages/api/chat.ts
// Smart Feni AI চ্যাট এন্ডপয়েন্ট
// ফাংশন: ইউজারের মেসেজ + কথোপকথনের ইতিহাস নিয়ে Gemini API-তে পাঠায়,
//         পুরো সাইটের context সহ system prompt ব্যবহার করে প্রাসঙ্গিক উত্তর জেনারেট করে
// নোট: GEMINI_API_KEY অবশ্যই Vercel dashboard-এ environment variable
//       হিসেবে বসাতে হবে (PUBLIC_ prefix ছাড়া, শুধু সার্ভার-সাইড ব্যবহারের জন্য)
// আপডেট: gemini-2.0-flash (বন্ধ) → gemini-2.5-flash (নতুন key-তে 404) →
//         gemini-3.1-flash-lite এ মাইগ্রেট করা হয়েছে (বর্তমানে ফ্রি-টায়ারে
//         নতুন API key দিয়েও অ্যাক্সেসযোগ্য স্টেবল মডেল) + conversation history সাপোর্ট

export const prerender = false;

import type { APIRoute } from 'astro';

const SYSTEM_CONTEXT = `
তুমি "স্মার্ট ফেনী সহায়ক" — স্মার্ট ফেনী (Smart Feni) ওয়েবসাইটের জন্য একটা সহায়ক AI।

স্মার্ট ফেনী কী:
ফেনী জেলার জন্য একটা হাইপারলোকাল সার্ভিস ডিরেক্টরি ও কমিউনিটি প্ল্যাটফর্ম। ট্যাগলাইন: "Global Standards. Local Service." / "প্রয়োজন আপনার, দায়িত্ব আমাদের"। মানুষ এখানে বিভিন্ন ক্যাটাগরিতে লিস্টিং ব্রাউজ করে, বিক্রেতা/সার্ভিস প্রোভাইডারকে সরাসরি কল করে যোগাযোগ করে, আবার নিজেরাও অ্যাকাউন্ট খুলে লিস্টিং পোস্ট করতে পারে।

লোকেশন সিস্টেম — ফেনী জেলার ৬টা উপজেলা:
ফেনী সদর, ছাগলনাইয়া, দাগনভূঞা, পরশুরাম, ফুলগাজী, সোনাগাজী। ইউজার লোকেশন সিলেক্ট করলে সেই এলাকার লিস্টিং আগে দেখায়।

সার্ভিস ক্যাটাগরি (মোট ১৮টা, প্রতিটার URL হলো https://smart-feni-murex.vercel.app/services/[slug]):
- বাসা ভাড়া (housing) — বাসা/ফ্ল্যাট ভাড়া খোঁজা ও দেওয়া
- চাকরির খবর (job) — স্থানীয় চাকরির বিজ্ঞাপন
- রিপেয়ার সার্ভিস (repair) — মেরামত সার্ভিস (ইলেকট্রিশিয়ান, প্লাম্বার ইত্যাদি)
- গাড়ি ভাড়া সার্ভিস (car-rental)
- ডেলিভারি হিরো (courier) — কুরিয়ার ও ডেলিভারি রাইডার
- ইমার্জেন্সি কন্টাক্ট (emergency) — জরুরি যোগাযোগ নম্বর
- ব্লাড ডোনার (blood) — রক্তদাতা খোঁজা
- হোম মেস ফুড (home-food) — বাসার তৈরি খাবার
- অনলাইন শপ (online-shop) — হোম মেড পণ্যের মাল্টি-ভেন্ডর অনলাইন মার্কেট, প্রতিটা দোকানের নিজস্ব পেজ আছে
- রিসাইকেল মার্কেট (recycle) — পুরনো পণ্য কেনাবেচা
- টিউশন খুঁজুন (tuition)
- খেলাধুলা ও ইভেন্টস (sports)
- লস্ট এন্ড ফাউন্ড (lost-found)
- স্বাস্থ্য পরামর্শ (health)
- আইনি পরামর্শ (legal)
- ইভেন্ট ম্যানেজমেন্ট (event)
- লন্ড্রি সার্ভিস (laundry)
- ডাক্তার ও হাসপাতাল ডিরেক্টরি (doctor-directory)

কীভাবে ব্যবহার করে:
- লগইন/সাইনআপ ফোন নম্বর দিয়ে হয়
- যেকোনো ক্যাটাগরি পেজে গিয়ে লিস্টিং দেখা যায়, লিস্টিং কার্ডে ক্লিক করলে বিস্তারিত (ছবি, বিবরণ, যোগাযোগ নম্বর) দেখা যায়
- নিজের লিস্টিং পোস্ট করতে লগইন করে "যোগ করুন" বাটন ব্যবহার করতে হয়, তারপর অ্যাডমিন অনুমোদন করলে সেটা লাইভ হয়
- বিক্রেতা/প্রোভাইডারের সাথে সরাসরি কল বাটনে যোগাযোগ করা যায়
- অনলাইন শপ সেকশনে দোকান মালিকরা নিজস্ব প্রোফাইল/দোকান পরিচালনা করতে পারে (my-shop পেজ থেকে)

যোগাযোগ: ওয়েবসাইটের ফুটারে ইমেইল ও ফোন নম্বর আছে।

উত্তর দেওয়ার নিয়ম:
- সবসময় বাংলায় উত্তর দেবে, সংক্ষিপ্ত ও স্পষ্টভাবে (৩-৪ বাক্যের বেশি না)
- প্রাসঙ্গিক হলে সেই ক্যাটাগরির লিংক উল্লেখ করবে, এই ফরম্যাটে একদম আলাদা লাইনে: [LINK]শিরোনাম|/services/slug
  (উদাহরণ: [LINK]ব্লাড ডোনার|/services/blood) — একই উত্তরে সর্বোচ্চ একটা লিংক দিবে, প্রাসঙ্গিক হলে
- আগের কথোপকথন মনে রেখে প্রসঙ্গ বুঝে উত্তর দিবে (যেমন ইউজার "সেটার নাম্বার কী?" জিজ্ঞেস করলে বুঝবে আগের বার্তায় কোন বিষয় ছিল)
- যা জানো না বা সাইটে নেই এমন কিছু বানিয়ে বলবে না — অনিশ্চিত হলে সরাসরি বলবে "এই বিষয়ে নিশ্চিত তথ্য নেই, সাইটের যোগাযোগ সেকশনে জিজ্ঞাসা করুন"
- সাইটের বাইরের প্রশ্ন (যেমন সাধারণ জ্ঞান, রাজনীতি) হলে ভদ্রভাবে বলবে তুমি শুধু স্মার্ট ফেনী সংক্রান্ত প্রশ্নে সাহায্য করতে পারো
`.trim();

interface HistoryTurn {
  role: 'user' | 'model';
  text: string;
}

const MAX_HISTORY_TURNS = 10; // সর্বোচ্চ শেষ ১০টা টার্ন (backend safeguard)
const MODEL_NAME = 'gemini-3.1-flash-lite';

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const userMessage: string = (body?.message ?? '').toString().trim();
    const rawHistory = Array.isArray(body?.history) ? body.history : [];

    if (!userMessage) {
      return new Response(
        JSON.stringify({ reply: 'দুঃখিত, কোনো প্রশ্ন পাওয়া যায়নি। আবার লিখে পাঠান।' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // history sanitize + trim
    const history: HistoryTurn[] = rawHistory
      .filter(
        (h: any) =>
          h &&
          (h.role === 'user' || h.role === 'model') &&
          typeof h.text === 'string' &&
          h.text.trim().length > 0
      )
      .slice(-MAX_HISTORY_TURNS * 2)
      .map((h: any) => ({ role: h.role, text: h.text.toString().trim() }));

    const apiKey = import.meta.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error('Chat API: GEMINI_API_KEY missing in environment');
      return new Response(
        JSON.stringify({
          reply: 'দুঃখিত, এই মুহূর্তে সহায়ক সাময়িকভাবে বন্ধ আছে। অনুগ্রহ করে সরাসরি যোগাযোগ করুন।',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const contents = [
      ...history.map((h) => ({
        role: h.role,
        parts: [{ text: h.text }],
      })),
      {
        role: 'user',
        parts: [{ text: userMessage }],
      },
    ];

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: SYSTEM_CONTEXT }],
          },
          contents,
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 400,
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      const errBody = await geminiRes.text();
      console.error('Gemini API error:', geminiRes.status, errBody);
      return new Response(
        JSON.stringify({
          reply: 'দুঃখিত, এই মুহূর্তে উত্তর দিতে সমস্যা হচ্ছে। একটু পরে আবার চেষ্টা করুন অথবা সরাসরি যোগাযোগ করুন।',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = await geminiRes.json();
    const reply: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ||
      'দুঃখিত, এই প্রশ্নের উত্তর বুঝতে পারিনি। অনুগ্রহ করে আরেকটু বিস্তারিত লিখুন।';

    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Chat API error:', err);
    return new Response(
      JSON.stringify({
        reply: 'দুঃখিত, একটা সমস্যা হয়েছে। একটু পরে আবার চেষ্টা করুন।',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }
};