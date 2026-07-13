import type { APIRoute } from "astro";
import { chatPost } from "astro-chat";
import { openai } from "astro-chat/providers";
import { loadSiteKnowledge } from "../../lib/siteKnowledge";

export const prerender = false;

const provider = openai({
  apiKey: import.meta.env.OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

export const POST: APIRoute = async ({ request }) => {
  const siteContent = await loadSiteKnowledge();
  
  return chatPost(request, {
    knowledge: {
      businessName: "স্মার্ট ফেনী",
      description: "আপনার শহরের ডিজিটাল সেবা",
      faqs: [
        { 
          question: "ওয়েবসাইট সম্পর্কে বিস্তারিত", 
          answer: siteContent 
        }
      ]
    },
    provider,
    systemPrompt: `তুমি স্মার্ট ফেনী ওয়েবসাইটের AI সহায়ক। নিচের তথ্যের ভিত্তিতে উত্তর দাও:
    
    ${siteContent}
    
    নির্দেশনা:
    1. শুধু উপরের তথ্য থেকেই উত্তর দাও।
    2. যদি উত্তর না জানো, তাহলে সেটা স্পষ্টভাবে বলে দাও।
    3. উত্তর যেন সংক্ষিপ্ত ও সহায়ক হয়।`,
  });
};