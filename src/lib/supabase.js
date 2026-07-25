import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

// ============================================================
// globalThis-ভিত্তিক singleton গার্ড
//
// কেন লাগলো: Astro-তে প্রতিটা .astro কম্পোনেন্টের <script> ব্লক
// আলাদাভাবে বান্ডল হয়ে ব্রাউজারে আলাদা module chunk হিসেবে লোড হয়।
// ফলে Header.astro, ProfileMenu.astro, AuthModal.astro ইত্যাদি
// একই পেজে থাকলে প্রতিটা নিজের createClient() কল করে ফেলছিল
// (এই ফাইল import করার মাধ্যমেই), কিন্তু ব্রাউজারের module cache
// এই সব আলাদা bundle-এর মধ্যে শেয়ার হচ্ছিল না — ফলে একই
// localStorage key ব্যবহার করে একাধিক GoTrueClient instance
// তৈরি হয়ে যাচ্ছিল, আর তারা একসাথে refresh token race করে
// একে অপরের সেশন invalidate করে ফেলছিল (refresh_token_not_found)।
//
// সমাধান: window/globalThis এ client instance ক্যাশ করে রাখা,
// যাতে যতগুলা আলাদা bundle-ই import করুক না কেন, সবাই একই
// browser-level instance ফেরত পায়।
// ============================================================

function getSupabaseClient() {
  if (typeof window === 'undefined') {
    // সার্ভার-সাইড রেন্ডারের সময় (SSR) প্রতিবার নতুন client — সমস্যা নেই,
    // কারণ SSR এ কোনো browser localStorage/session persist হয় না।
    return createClient(supabaseUrl, supabaseAnonKey);
  }

  if (!window.__smartFeniSupabaseClient) {
    window.__smartFeniSupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'smartfeni-auth',
      },
    });
  }

  return window.__smartFeniSupabaseClient;
}

export const supabase = getSupabaseClient();