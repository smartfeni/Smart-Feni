# Smart Feni — Claude Code নিয়ম

ফেনী জেলার হাইপারলোকাল কমিউনিটি সার্ভিস প্ল্যাটফর্ম (smartfeni.com)।
স্ট্যাক: Astro v5 + Supabase (Pro) + Vercel + Capacitor (Android)। দ্বিতীয় অ্যাপ: Smart Feni Pro।
ইউজার: SF (Md Shariful Islam)। যোগাযোগ বাংলা/বাংলিশে, সংক্ষেপে, একটাই পথ বলো।

## ব্রান্চ ও কমিট (সবচেয়ে জরুরি)
- রিমোটে শুধু `main` (production) ও `testing`। নতুন ব্রান্চ বানাবে না।
- সব কমিট শুধু `testing`-এ। `main`-এ সরাসরি কমিট/পুশ নয় (মাঝরাতে SF নিজে merge করেন)।
- জরুরি ফিক্স `main`-এ যাবে শুধু SF স্পষ্ট বললে।
- কাজ শুরুর আগে `git branch --show-current` চেক করো; `testing` না হলে থামো।
- এক কাজ = এক কমিট। `git add .` নয়, ফাইল নাম স্পষ্ট দাও।
- কাজের আগে বদলানোর ফাইল `testing` থেকে লেটেস্ট পড়ো।

## কাজের ধারা
- আগে প্ল্যান (কোন ফাইল, কী বদল, ঝুঁকি) → SF "ok" বললে কাজ।
- অন্য অ্যাকাউন্ট/সেশন একই কাজ করেছে কিনা `dev_changelog`-এর সর্বশেষ ~২০ সারিতে দেখো।
- কাজ শেষে `dev_changelog`-এ এক সারি লগ (account, area, summary, files, db_objects, status, committed, notes)।
- `admin/index.astro`-র মতো ঝুঁকিপূর্ণ ফাইল ওভাররাইট নয়; কারেন্ট ফাইল নিয়ে ছোট প্যাচ।

## ডাটাবেস (Supabase)
- DB বদল সাথে সাথে লাইভ। শুধু additive ও পুরনো (`main`) কোডের সাথে সামঞ্জস্যপূর্ণ বদল।
- কলাম/ফাংশন মুছে ফেলা বা নাম বদল `main` merge-এর পরের ধাপে।
- DB বদলের আগে SF-কে প্ল্যান বলো, "ok"-এর পর চালাও; বদলের পর আবার query করে যাচাই।
- নতুন টেবিলে RLS + `WITH CHECK`। নতুন FK-তে `ON DELETE` স্পষ্ট।
- নতুন SECURITY DEFINER ফাংশনে `search_path` সেট, দরকার না হলে `anon` EXECUTE বন্ধ।
- policy-তে helper ফাংশন বসালে anon EXECUTE যাচাই + `SELECT * FROM audit_anon_policy_functions()` (খালি = ঠিক)।
- RPC-তে `auth.uid()` ব্যবহার করো; গেস্টে (null) পাস না করতে `is distinct from` + লগইন বাধ্যতামূলক।

## কোডের নিয়ম
- ইউজারের লেখা টেক্সট `innerHTML`-এ বসানোর আগে এস্কেপ (`esc()`/`huEsc()`) বা `textContent`।
- Supabase client শুধু `src/lib/supabase.js` থেকে।
- Astro scoped CSS JS-injected HTML-এ কাজ করে না → `<style is:global>` বা inline।
- `define:vars` + dynamic import নয়।
- ফর্মে `required` + লাল `*` + `window.SFValidateForm()` + `window.showToast()`।
- লোডার: শেয়ার্ড `SFLoader`/`SFLoading`। নিজের spinner বা টাইম পিকার বানাবে না।
- লম্বা পাবলিক সেকশন ডিফল্টে ভাঁজ করা (`<button aria-expanded>`, বডি `hidden`)।
- নোটিফিকেশন `action_url`-এ `?tab=`/`?open=`। নতুন অ্যাডমিন-নোটিফিকেশনে `private.admin_notify_permission_for_url`-এ লাইন যোগ।
- নতুন API রুটে `Authorization` + permission চেক, আর `serverErrorReporter`।
- Gemini মডেলের নাম শুধু `geminiConfig.js`-এ।
- রাইডার অনলাইন (`delivery_online`/`ride_online`) কোডে সরাসরি লিখবে না; `is_active` ট্রিগারে ডেরাইভড।

## ডিজাইন
- মোবাইল-ফার্স্ট, top-notch UI। primary `#FF6B35`, navy `#1B2A4A`, পেজ bg `#FFF4EC`, সাদা কার্ড, rounded 12–24px।
- "সহজি" নাম ও "Smart Hero" ব্র্যান্ডিং কোথাও নয়।

## Pro অ্যাপ
- Pro-তে মেইন পেজের জেনারেটেড কপি আছে। মেইনের `delivery-hero`/`offline-orders`/`ride-hero` বদলালে `/pro/hero/...` কপিতেও তোলো।

## করবে না
- সিক্রেট/টোকেন/API key কোডে বা কমিটে নয়।
- অনুমান করে ফাইল পাথ/কলামের নাম লিখবে না।
- Telegram webhook secret যাচাই ও Telegram নোটিফিকেশন নিয়ে আর প্রস্তাব নয় (SF বাদ দিয়েছেন)।
- মাল্টি-ক্লাব, অরফান ছবি অটো-মোছা: বাদ।

## বিস্তারিত
মাস্টার ব্লুপ্রিন্ট: `PROJECT_BLUEPRINT.md` (আলাদা রাখলে এখানে পাথ বসাও)।
