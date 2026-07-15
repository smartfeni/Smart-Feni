# স্মার্ট ফেনী (Smart Feni) — প্রজেক্ট ব্লুপ্রিন্ট

> এই ফাইলটা পুরো প্রজেক্টের একটা "সিঙ্গেল সোর্স অফ ট্রুথ"। ভবিষ্যতে কোনো পরিবর্তন করার আগে
> এই ফাইলটা পড়ে নিলে পুরো কন্টেক্সট, আগের সিদ্ধান্ত, এবং established pattern গুলো বুঝে নেওয়া যাবে।
> কোনো বড় পরিবর্তন করলে এই ফাইলটাও আপডেট করে রাখা উচিত।

সর্বশেষ আপডেট: জুলাই ২০২৬

---

## ১. প্রজেক্ট পরিচিতি

| বিষয় | বিস্তারিত |
|---|---|
| নাম | স্মার্ট ফেনী / Smart Feni (স্মার্ট ফেনী) |
| ট্যাগলাইন | Global Standards. Local Service. |
| ব্র্যান্ড স্লোগান | প্রয়োজন আপনার, দায়িত্ব আমাদের |
| কনসেপ্ট | ফেনী জেলার জন্য মাল্টি-ক্যাটাগরি হাইপারলোকাল কমিউনিটি সার্ভিস ডিরেক্টরি (Urban Company + Fiverr হাইব্রিড স্টাইল, বাংলা লোকাল কনটেক্সটে) |
| লাইভ সাইট | https://smart-feni-murex.vercel.app |
| GitHub রিপো | https://github.com/smartfeni/Smart-Feni |
| ডেভেলপার | একমাত্র ফাউন্ডার + ডেভেলপার, সৌদি আরব ও বাংলাদেশে সময় ভাগ করে কাজ করেন |
| ডেভ এনভায়রনমেন্ট | মোবাইল-ফার্স্ট: Termux (Android) দিয়ে git অপারেশন, কোড GitHub-এ push, Vercel-এ deploy |
| ডেপ্লয়মেন্ট | ম্যানুয়াল — ইউজার নিজে `deploy.sh` স্ক্রিপ্ট অথবা `git push` দিয়ে করেন, Claude ফাইল শুধু তৈরি করে দেয় |

### টেক স্ট্যাক
- **ফ্রেমওয়ার্ক:** Astro v4 (হাইব্রিড: static default + per-page `export const prerender = false` দিয়ে SSR)
- **ব্যাকএন্ড/ডেটাবেজ:** Supabase (Auth, PostgreSQL Database, Storage)
- **হোস্টিং:** Vercel
- **AI চ্যাটবট:** Google Gemini API (`generativelanguage.googleapis.com`)

---

## ২. লোকেশন সিস্টেম

ফেনী জেলার ৬টা উপজেলা (কোঅর্ডিনেট `services.js` / `LocationSelector.astro`-তে সংরক্ষিত):

| উপজেলা | কোঅর্ডিনেট |
|---|---|
| ফেনী সদর | 23.0159, 91.3976 |
| ছাগলনাইয়া | 23.0389, 91.5194 |
| দাগনভূঞা | 22.9833, 91.1833 |
| পরশুরাম | 23.2250, 91.4500 |
| ফুলগাজী | 23.0700, 91.4500 |
| সোনাগাজী | 22.8500, 91.3917 |

**লজিক:** GPS auto-detect করে Haversine formula দিয়ে nearest উপজেলা বের করে। ৪০কিমি-এর বাইরে হলে (যেমন ইউজার সৌদি আরব থেকে থাকলে) ম্যানুয়াল সিলেকশনে পাঠায়। ফলব্যাক ডিফল্ট: ফেনী সদর।
`LocationSelector.astro` কম্পোনেন্ট `smartfeni:upazila-changed` কাস্টম ইভেন্ট dispatch করে, যা `Header.astro` শোনে এবং ব্যাকগ্রাউন্ড লাইভ আপডেট করে।

---

## ৩. ডিজাইন সিস্টেম

| টোকেন | মান |
|---|---|
| Primary accent | `#FF6B35` (কমলা) |
| Navy/text | `#1B2A4A` |
| Background | `#F8FAFC` (হালকা ধূসর-সাদা) |
| কার্ড স্টাইল | সাদা ব্যাকগ্রাউন্ড, rounded corners (12–24px), হালকা shadow, hover-এ lift effect |
| রেফারেন্স ইন্সপিরেশন | Urban Company (circular colorful icon badge, prominent search bar), Fiverr (card grid) |

**ডিজাইন ফিলোসফি:** মিনিমাল শুরু, প্রয়োজন হলে ধাপে ধাপে জটিলতা যোগ। Stats, Testimonials, CTA সেকশন ইচ্ছাকৃতভাবে বাদ দেওয়া হয়েছে ("add later if needed" নীতি)।

---

## ৪. সার্ভিস ক্যাটাগরি (মোট ১৮টা)

প্রতিটার URL: `https://smart-feni-murex.vercel.app/services/[slug]`

| বাংলা নাম | Slug | কাস্টম ডিজাইন? |
|---|---|---|
| বাসা ভাড়া | `housing` | না (generic template) |
| চাকরির খবর | `job` | না |
| রিপেয়ার সার্ভিস | `repair` | না |
| গাড়ি ভাড়া | `car-rental` | ✅ হ্যাঁ |
| ডেলিভারি হিরো (কুরিয়ার) | `courier` | ✅ হ্যাঁ |
| ইমার্জেন্সি কন্টাক্ট | `emergency` | না |
| ব্লাড ডোনার | `blood` | ✅ হ্যাঁ (`is_blood_donor` ফিল্টার) |
| হোম মেস ফুড | `home-food` | ✅ হ্যাঁ |
| অনলাইন শপ (মাল্টি-ভেন্ডর) | `online-shop` | ✅ হ্যাঁ |
| রিসাইকেল মার্কেট | `recycle` | না |
| টিউশন | `tuition` | না |
| খেলাধুলা ও ইভেন্টস | `sports` | না |
| লস্ট এন্ড ফাউন্ড | `lost-found` | ✅ হ্যাঁ |
| স্বাস্থ্য পরামর্শ | `health` | ✅ হ্যাঁ |
| আইনি পরামর্শ | `legal` | না |
| ইভেন্ট ম্যানেজমেন্ট | `event` | না |
| লন্ড্রি সার্ভিস | `laundry` | না |
| ডাক্তার ও হাসপাতাল ডিরেক্টরি | `doctor-directory` | না |

**⚠️ ক্লিনআপ পেন্ডিং:** এই orphan ফাইলগুলো রিপোতে আছে কিন্তু আর ব্যবহৃত হয় না — ডিলিট করা বাকি:
`cleaning.astro`, `marriage.astro`, `used.astro`, `plumbing.astro`, `food.astro`, `lost.astro` (নতুন `lost-found.astro` দিয়ে রিপ্লেসড)

---

## ৫. কম্পোনেন্ট স্ট্রাকচার

```
src/components/
├── layout/
│   ├── Header.astro       — ৩-কলাম (লোকেশন / লোগো+ট্যাগলাইন / প্রোফাইল), উপজেলা বদলালে ব্যাকগ্রাউন্ড লাইভ আপডেট
│   ├── Footer.astro        — মিনিমাল, লোগো + ট্যাগলাইন + সোশ্যাল + যোগাযোগ (⚠️ placeholder info এখনো)
│   └── BaseLayout.astro    — গ্লোবাল লেআউট, এখানেই ChatWidget mount করা
├── ui/
│   ├── LocationSelector.astro
│   ├── Hero.astro          — শুধু সার্চ বার, wipe-animation রোটেটিং হিন্ট টেক্সট
│   ├── CategoryGrid.astro  — প্রতি লাইনে ৩টা কার্ড ফিক্সড কলাম
│   ├── FeaturedPhotos.astro — Supabase থেকে multi-photo crossfade slideshow
│   └── AuthModal.astro
├── shared/
│   └── CategoryCard.astro  — circular icon badge, auto color hash
└── ChatWidget.astro         — AI চ্যাট উইজেট (বিস্তারিত সেকশন ৮-এ)
```

---

## ৬. Admin প্যানেল (`/admin/`)

- `adminGuard.js` — ক্লায়েন্ট-সাইড role check, `smartfeni:admin-ready` কাস্টম ইভেন্ট প্যাটার্ন ব্যবহার করে। প্রতিটা admin পেজে HTML কন্ট্রাক্ট: `id="adminLoadingState"` (ডিফল্টে দেখানো) / `id="adminGuardedContent"` (লুকানো, guard পাস করলে দেখানো হয়)
- **Dashboard** — সার্বিক ওভারভিউ
- **Listings moderation** — `is_reviewed` বুলিয়ান দিয়ে নতুন/আনরিভিউড ট্র্যাকিং, approve/reject/delete
- **User management** — block/unblock (two-click confirm), expandable per-user listing details
- **Featured photos** — `/admin/images/featured-photo` থেকে ম্যানেজ
- **Moderator management** — admin-only, grant/revoke moderator role

### Image management hub (`/admin/images/`)
| রুট | ফাংশন |
|---|---|
| `/featured-photo` | Multi-photo crossfade slideshow (5s interval, canvas-based 1600×900 crop, dual-image crossfade) |
| `/logo` | PNG উইথ ট্রান্সপারেন্সি, max 800px |
| `/header` | ৭ স্লট: `header_default` fallback + ৬টা উপজেলা-ভিত্তিক (1600×240 crop) |

**⚠️ পুরনো bug (ফিক্সড):** `define:vars` + dynamic import Astro/Vite-এ silent bundling failure দেয় — স্ট্যাটিক `import` ব্যবহার করে ফিক্স করা হয়েছে।

---

## ৭. Database Schema (Supabase)

### `profiles` টেবিল
| কলাম | টাইপ | নোট |
|---|---|---|
| `role` | enum | user / moderator / admin |
| `is_blocked` | boolean | |
| `blood_group` | text | |
| `upazila` | text | |
| `recovery_email` | text | ঐচ্ছিক |
| `is_blood_donor` | boolean | ⚠️ **এখনো যোগ করা হয়নি (পেন্ডিং)** |

### `listings` টেবিল
- `is_reviewed` (boolean) — নতুন/আনরিভিউড ট্র্যাকিং

### `featured_photos` টেবিল
- `id`, `storage_path`, `sort_order`

### `site_images` টেবিল
- `image_key` (PRIMARY KEY), `storage_path`, `updated_at`

### ফাংশন ও পলিসি
- `is_admin_or_mod()` — SECURITY DEFINER ফাংশন, RLS পলিসিতে ব্যবহৃত
- Storage restrictive policies — `listing-images` বাকেটে `site/` ফোল্ডারের জন্য

---

## ৮. Auth সিস্টেম

- **ফোন-বেসড লগইন:** Supabase Auth ইমেইল লাগে বলে ফোন নম্বরকে dummy email-এ কনভার্ট করা হয় (`phone@smartfeni.local`)
- **পোস্ট-লগইন ফ্লো:** `role` fetch → admin/moderator হলে `/admin`-এ রিডাইরেক্ট → `is_blocked` চেক → ব্লকড হলে সাইন আউট + বাংলা সাসপেনশন মেসেজ (`white-space: pre-line`)
- **সাইনআপে যা নেওয়া হয়:** পূর্ণ নাম, ফোন, পাসওয়ার্ড, ঐচ্ছিক recovery email, blood group, upazila, ঐচ্ছিক প্রোফাইল ছবি

**⚠️ পেন্ডিং:** Forget/reset password ফ্লো (Edge Function + recovery_email-এ ইমেইল সার্ভিস) — স্কোপড কিন্তু কোড করা হয়নি।

---

## ৯. AI চ্যাটবট (ChatWidget) — সবচেয়ে সাম্প্রতিক কাজ

### আর্কিটেকচার
```
src/components/ChatWidget.astro   ← ফ্রন্টএন্ড উইজেট (bubble + panel + form)
src/pages/api/chat.ts             ← ব্যাকএন্ড এন্ডপয়েন্ট, Gemini API কল করে
```

### `api/chat.ts` — কীভাবে কাজ করে
1. ইউজারের মেসেজ + কথোপকথনের history (frontend থেকে) নেয়
2. `SYSTEM_CONTEXT`-এ পুরো সাইটের তথ্য (ক্যাটাগরি লিস্ট, উপজেলা, ব্যবহারবিধি) দেওয়া আছে
3. Gemini API-তে POST করে (`v1beta/models/{MODEL_NAME}:generateContent`)
4. Reply-তে `[LINK]শিরোনাম|/services/slug` প্যাটার্ন থাকলে frontend সেটাকে ক্লিকযোগ্য কার্ডে রেন্ডার করে
5. Error হলে console-এ পুরো status + body log হয় (ডিবাগিং-এর জন্য জরুরি)

### ⚠️ Gemini মডেল মাইগ্রেশন হিস্ট্রি (গুরুত্বপূর্ণ শিক্ষা)
Google Gemini প্রায়ই মডেল ডিপ্রিকেট/রেস্ট্রিক্ট করে। এই প্রজেক্টে যা ঘটেছে:

| তারিখ/সময় | মডেল | সমস্যা |
|---|---|---|
| শুরুতে | `gemini-2.0-flash` | ১ জুন ২০২৬ বন্ধ হয়ে গেছে → 429 (quota limit: 0) |
| প্রথম ফিক্স | `gemini-2.5-flash` | নতুন API key-তে 404 ("no longer available to new users") |
| **বর্তমান (কার্যকর)** | **`gemini-3.1-flash-lite`** | ✅ কাজ করছে — নতুন key দিয়েও ফ্রি টিয়ারে অ্যাক্সেসযোগ্য |

**ভবিষ্যতে চ্যাটবট আবার একই এরর দিলে (৪২৯/৪০৪) সবচেয়ে প্রথমে চেক করার জিনিস:**
1. Vercel dashboard → Logs ট্যাবে গিয়ে exact status code/error body দেখা (কোডে ইতিমধ্যে `console.error('Gemini API error:', ...)` লগিং আছে)
2. Google-এর মডেল ডিপ্রিকেশন পেজ চেক করা: https://ai.google.dev/gemini-api/docs/changelog
3. `src/pages/api/chat.ts`-এর `MODEL_NAME` কনস্ট্যান্ট আপডেট করা (এক জায়গায় বদলালেই যথেষ্ট)

### `GEMINI_API_KEY` env variable
- Vercel dashboard → প্রজেক্ট → Settings → Environment Variables-এ সেট থাকতে হবে (কোনো `PUBLIC_` prefix ছাড়া, সার্ভার-সাইড-only)

### ChatWidget UI ফিচার (সর্বশেষ ভার্সন)
- Conversation history — `sessionStorage`-এ persist হয় (key: `sf_chat_messages_v1`), ট্যাব রিফ্রেশে চ্যাট হারায় না
- Backend-এ শেষ ২০টা মেসেজ history আকারে পাঠানো হয় (context-aware রিপ্লাই)
- "নতুন চ্যাট" বাটন — হেডারে reset আইকন
- Link card রেন্ডারিং — বট রিপ্লাইয়ে ক্যাটাগরি রেফারেন্স থাকলে ক্লিকযোগ্য কার্ড দেখায়
- থাম্বস আপ/ডাউন ফিডব্যাক (client-side only, কোনো ব্যাকএন্ড স্টোরেজ নেই এখনো)
- প্রাসঙ্গিক Quick reply প্রশ্ন: "কীভাবে লিস্টিং পোস্ট করব?", "ব্লাড ডোনার কীভাবে খুঁজব?", "আমার উপজেলায় কী সার্ভিস আছে?", "অ্যাকাউন্ট কীভাবে খুলব?"

**🔑 জরুরি টেকনিক্যাল নোট:** Astro-এর scoped CSS জাভাস্ক্রিপ্ট দিয়ে dynamically তৈরি করা এলিমেন্টে কাজ করে না (এই প্রজেক্টের একটা established, বারবার দেখা bug)। তাই ChatWidget-এর সব dynamically তৈরি এলিমেন্ট (message bubble, link card, feedback icon, quick-reply বাটন, typing indicator) `setAttribute("style", ...)` দিয়ে ইনলাইন স্টাইল পায়, CSS ক্লাসের উপর নির্ভর করে না। এই একই কারণে আগে featured-photo slideshow-এও সমস্যা হয়েছিল (নিচে সেকশন ১১ দেখুন)।

---

## ১০. Git/Deploy ওয়ার্কফ্লো (Termux)

```bash
# ফাইল পরিবর্তনের পর:
git status                          # কী বদলেছে/স্টেজড না তা দেখা
git add <file>
git commit -m "মেসেজ"
git push origin main

# অথবা সরাসরি Vercel-এ deploy (GitHub push এর ঝামেলা এড়াতে):
./deploy.sh
```

**⚠️ পরিচিত সমস্যা ও সমাধান:**
- `git commit` fail (Author identity unknown) → একবার সেট করে নিতে হবে:
  ```
  git config --global user.email "তোমার-ইমেইল@example.com"
  git config --global user.name "SmartFeni"
  ```
- `git push` fail (password authentication not supported) → GitHub এখন password নেয় না, Personal Access Token (PAT) লাগবে। **এখনো সেটআপ করা হয়নি — ভবিষ্যতের টাস্ক।**
- `./deploy.sh` স্ক্রিপ্ট থাকায় GitHub push ছাড়াও সরাসরি Vercel production-এ deploy করা সম্ভব (ইতিমধ্যে কার্যকর প্রমাণিত)

---

## ১১. মূল শিক্ষা ও প্রিন্সিপাল (Key Learnings)

1. **Astro scoped CSS dynamically injected HTML-এ কাজ করে না** — সব dynamic content-এ inline style ব্যবহার করা প্রজেক্ট-ওয়াইড established pattern।
2. **`define:vars` + dynamic import Astro/Vite-এ silent bundling failure দেয়** — স্ট্যাটিক `import` ব্যবহার করতে হবে।
3. **Supabase Auth-এ ইমেইল বাধ্যতামূলক** — ফোন-only auth-এর জন্য dummy email কনস্ট্রাক্ট করা হয় (`phone@smartfeni.local`)।
4. **বিদেশ থেকে GPS auto-detection** — Haversine distance + 40km threshold দিয়ে ভুল উপজেলা ডিটেকশন এড়ানো হয় (ডেভেলপার সৌদি আরবে থাকাকালীন এই সমস্যা সামনে এসেছিল)।
5. **Cache-busting** — dynamic site images (logo, header) `?v=${timestamp}` দিয়ে লোড হয়, স্টেল ক্যাশ এড়াতে।
6. **Gemini/থার্ড-পার্টি AI API মডেল ভার্সন দ্রুত ডিপ্রিকেট হয়** — মডেল নেম hardcode না করে এক জায়গায় কনস্ট্যান্ট রাখা ভালো, আর ভবিষ্যতে হঠাৎ error দিলে প্রথমে Vercel logs আর Google-এর official changelog চেক করা উচিত।
7. **মিনিমাল ডিজাইন ফিলোসফি** — ফিচার essentials-এ রাখা, প্রয়োজন হলে ধাপে ধাপে যোগ করা।

---

## ১২. পেন্ডিং/ভবিষ্যৎ টাস্ক লিস্ট

- [ ] `is_blood_donor` কলাম `profiles` টেবিলে যোগ করা (boolean, default false)
- [ ] Blood donor টগল `profile/edit.astro`-তে (blood group সেট থাকা বাধ্যতামূলক শর্ত হিসেবে)
- [ ] Forget/reset password ফ্লো (Edge Function + recovery_email)
- [ ] Header background images (৬টা, 1600×240px, safe white zones: x=0–260, x=620–980, x=1340–1600)
- [ ] Orphan ফাইল ডিলিট: `cleaning.astro`, `marriage.astro`, `used.astro`, `plumbing.astro`, `food.astro`, `lost.astro`
- [ ] Footer-এ placeholder যোগাযোগ তথ্য বদলে রিয়েল ইনফো বসানো
- [ ] GitHub push-এর জন্য Personal Access Token (PAT) সেটআপ (git commit identity + push auth ঠিক করা)
- [ ] ChatWidget ফিডব্যাক (thumbs up/down) ব্যাকএন্ডে সংরক্ষণ করার সিস্টেম (বর্তমানে client-side only)
- [ ] Gemini মডেল ভবিষ্যতে আবার ডিপ্রিকেট হলে migration checklist অনুসরণ করা (সেকশন ৯ দেখুন)

---

## ১৩. Claude-এর সাথে কাজ করার নিয়ম (রেফারেন্স)

1. কোনো কোড পরিবর্তনের আগে প্ল্যান বলা, কোড পরে দেওয়া — ইউজার "ঠিক আছে/ok" বললে তারপর কোড
2. কোড সবসময় সম্পূর্ণ ফাইল আকারে (diff/partial edit না), ফাইলের পুরো পাথ উল্লেখ করে
3. একবারে একটা ফাইল, "ok" বললে পরের ফাইলে যাওয়া
4. ছবি/অ্যাসেট লাগলে সাইজ, ফরম্যাট, ফাইলনেম ও ঠিক কোন `public/...` পাথে বসাতে হবে তা স্পষ্ট করে বলা
5. প্রতিটা ফাইল পরিবর্তনের পর সংক্ষেপে কী কী বদলেছে বলা
6. Claude-এর GitHub-এ সরাসরি write access নেই — ইউজারকেই কপি-পেস্ট/কমিট করতে হয়
7. সব যোগাযোগ বাংলা/বাংলিশে

---

*এই ডকুমেন্ট প্রজেক্টের evolving reference — বড় কোনো ফিচার/আর্কিটেকচার পরিবর্তনের পর এটাও আপডেট করে রাখা উচিত।*
