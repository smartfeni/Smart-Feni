import type { APIRoute } from "astro";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { message } = await request.json();
    
    // ওয়েবসাইটের বেসিক তথ্য
    const siteContent = `স্মার্ট ফেনী একটি ডিজিটাল সেবা প্ল্যাটফর্ম। 
এখানে আপনি বিভিন্ন সেবা পেতে পারেন যেমন: 
- ইভেন্ট আয়োজন
- কমিউনিটি ফটো শেয়ার
- বিভিন্ন ক্যাটাগরির সেবা

আমাদের ওয়েবসাইটে আরও বিস্তারিত জানতে পারেন।`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${import.meta.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "meta-llama/llama-3.2-3b-instruct:free",
        messages: [
          {
            role: "system",
            content: `তুমি স্মার্ট ফেনী ওয়েবসাইটের AI সহায়ক। নিচের তথ্যের ভিত্তিতে উত্তর দাও:
            
${siteContent}

নির্দেশনা:
1. শুধু উপরের তথ্য থেকেই উত্তর দাও।
2. যদি উত্তর না জানো, তাহলে সেটা স্পষ্টভাবে বলে দাও।
3. উত্তর যেন সংক্ষিপ্ত ও সহায়ক হয়।`
          },
          {
            role: "user",
            content: message
          }
        ],
        max_tokens: 500,
      }),
    });

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || "দুঃখিত, আমি উত্তর দিতে পারছি না।";
    
    return new Response(JSON.stringify({ reply }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "সার্ভার সমস্যা হয়েছে" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};