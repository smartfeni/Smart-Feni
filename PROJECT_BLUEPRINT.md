# স্মার্ট ফেনী (Smart Feni) — প্রজেক্ট ব্লুপ্রিন্ট (v2)

> এই ফাইলটা পুরো প্রজেক্টের একটা "সিঙ্গেল সোর্স অফ ট্রুথ"। ভবিষ্যতে কোনো পরিবর্তন করার আগে
> এই ফাইলটা পড়ে নিলে পুরো কন্টেক্সট, আগের সিদ্ধান্ত, এবং established pattern গুলো বুঝে নেওয়া যাবে।
> কোনো বড় পরিবর্তন করলে এই ফাইলটাও আপডেট করে রাখা উচিত।
>
> **এই ভার্সন পুরো রিপো (৯৫+ পেজ, ৫০+ কম্পোনেন্ট, ১৬+ lib ফাইল) স্ক্যান করে বানানো — জুলাই ২০২৬ ভার্সনের
> তুলনায় অনেক বড় বড় নতুন সিস্টেম (native app আর্কিটেকচার বদল, ক্লাব/শপ ইকোসিস্টেম, ডেলিভারি/রাইড হিরো,
> লাকি ড্র, টেলিগ্রাম বট) এখানে প্রথমবার ডকুমেন্টেড হলো।**

সর্বশেষ আপডেট: সেপ্টেম্বর ২০২৬

---

## ১. প্রজেক্ট পরিচিতি

| বিষয় | বিস্তারিত |
|---|---|
| নাম | স্মার্ট ফেনী / Smart Feni |
| ট্যাগলাইন | Global Standards. Local Service. |
| ব্র্যান্ড স্লোগান | প্রয়োজন আপনার, দায়িত্ব আমাদের |
| কনসেপ্ট | ফেনী জেলার জন্য মাল্টি-ক্যাটাগরি হাইপারলোকাল কমিউনিটি সার্ভিস প্ল্যাটফর্ম — এখন শুধু লিস্টিং ডিরেক্টরি না, ক্লাব/শপ/ডেলিভারি-রাইড মার্কেটপ্লেস সহ একটা পূর্ণ ইকোসিস্টেম |
| **প্রধান ডোমেইন** | **https://smartfeni.com** (canonical — `.vercel.app` থেকে 301 রিডাইরেক্ট, middleware.ts-এ হার্ডকোডেড) |
| Vercel সাবডোমেইন | https://smart-feni-murex.vercel.app (রিডাইরেক্ট সোর্স, ডিরেক্ট ইউজ বন্ধ) |
| **ক্লাব সাবডোমেইন** | **club.smartfeni.com** — middleware.ts এ `/` কে `/clubs` এ rewrite করে |
| GitHub রিপো | https://github.com/smartfeni/Smart-Feni |
| ডেভেলপার | একমাত্র ফাউন্ডার + ডেভেলপার (SF), সৌদি আরব ও বাংলাদেশে সময় ভাগ করে কাজ করেন |
| ডেভ এনভায়রনমেন্ট | **সম্পূর্ণ মোবাইল থেকে** — GitHub মোবাইল অ্যাপ + মোবাইল ব্রাউজার দিয়ে কোড ম্যানেজমেন্ট, কোনো টার্মিনাল/কম্পিউটার অ্যাক্সেস নেই |
| ডেপ্লয়মেন্ট | Vercel-এ, GitHub push হলে বিল্ড হয় (auto-deploy সম্পর্কে সেকশন ১১ দেখুন) |

### টেক স্ট্যাক
- **ফ্রেমওয়ার্ক:** Astro v5, `output: 'static'` + `@astrojs/vercel` adapter, প্রায় প্রতিটা ডাইনামিক পেজে per-page `export const prerender = false` (১০৩টা ফাইলে)
- **ব্যাকএন্ড/ডেটাবেজ:** Supabase — PostgreSQL, Auth, Storage, `pg_cron`, `pg_net` (Supabase project ref: `hedloawcvnbleehnurqd`)
- **হোস্টিং:** Vercel (team: `team_mus3sGskSO6wMaaGkEU2R7I8`, project: `prj_5PjPdMEt4eysC0pnU8uxCrqTrM00`)
- **নেটিভ অ্যাপ:** **Capacitor** (Android) — নিচে সেকশন ১২ দেখুন, এটা আগে PWABuilder/TWA ছিল না বলে ভুল লেখা হয়েছিল, এখন কারেক্ট করা হলো
- **AI:** Google Gemini API — (ক) ChatWidget-এর চ্যাটবট রিপ্লাই, (খ) `geminiExtract.js` দিয়ে স্ক্রিনশট থেকে লিস্টিং ডেটা এক্সট্র্যাকশন (housing/recycle/job/repair/tuition/sports/blood ক্যাটাগরিতে)
- **Push:** ডুয়াল — web-push (VAPID, ব্রাউজার) + firebase-admin/FCM (native Android app)
- **অন্যান্য:** Telegram Bot API (নোটিফিকেশন + অ্যাডমিন চ্যাট), Google Analytics 4 + কাস্টম Supabase events টেবিল

---

## ২. লোকেশন সিস্টেম (অপরিবর্তিত)

ফেনী জেলার ৬টা উপজেলা (`services.js` / `LocationSelector.astro`-তে সংরক্ষিত):

| উপজেলা | কোঅর্ডিনেট |
|---|---|
| ফেনী সদর | 23.0159, 91.3976 |
| ছাগলনাইয়া | 23.0389, 91.5194 |
| দাগনভূঞা | 22.9833, 91.1833 |
| পরশুরাম | 23.2250, 91.4500 |
| ফুলগাজী | 23.0700, 91.4500 |
| সোনাগাজী | 22.8500, 91.3917 |

**লজিক:** GPS auto-detect করে Haversine formula দিয়ে nearest উপজেলা বের করে। ৪০কিমি-এর বাইরে হলে (প্রবাসী ইউজার) ম্যানুয়াল সিলেকশনে পাঠায়। ফলব্যাক ডিফল্ট: ফেনী সদর। `LocationSelector.astro` কাস্টম ইভেন্ট `smartfeni:upazila-changed` dispatch করে, `Header.astro` তা শুনে ব্যাকগ্রাউন্ড লাইভ আপডেট করে।

---

## ৩. ডিজাইন সিস্টেম (কোর টোকেন অপরিবর্তিত)

| টোকেন | মান |
|---|---|
| Primary accent | `#FF6B35` (কমলা) |
| Navy/text | `#1B2A4A` |
| Background | `#F8FAFC` |
| PWA theme_color (manifest) | `#FFFFFF` |
| কার্ড স্টাইল | সাদা ব্যাকগ্রাউন্ড, rounded corners (12–24px), হালকা shadow, hover-এ lift effect |
| রেফারেন্স ইন্সপিরেশন | Urban Company (circular icon badge, prominent search) + Fiverr (card grid) |

---

## ৪. নেভিগেশন / UI আর্কিটেকচার (নতুন — মোবাইল-ফার্স্ট রিডিজাইন)

Header-শুধু নেভিগেশন থেকে সরে এখন **bottom nav + drawer** প্যাটার্নে চলে গেছে:

- **`BottomNav.astro`** — মোবাইল-ফার্স্ট বটম বার। অর্ডার: হোম | ক্যাটাগরি | ➕পোস্ট (elevated বাটন) | মেসেজ | প্রোফাইল (আইকন `fa-bars`, সরাসরি প্রোফাইল না — হ্যামবার্গার ড্রয়ার খোলে)
- **`HamburgerMenu.astro`** — ডান দিক থেকে স্লাইড-ইন, `smartfeni:open-hamburger-menu` কাস্টম ইভেন্টে ট্রিগার (লগইন থাকলে)
- **`CategoryDrawer.astro`** — সব ক্যাটাগরি স্লাইড-ইন ড্রয়ার, `smartfeni:open-category-drawer` ইভেন্টে ট্রিগার
- **`PostFlowDrawer.astro`** — "➕পোস্ট" থেকে ট্রিগার, কোন ক্যাটাগরিতে লিস্টিং/সার্ভিস দেওয়া যাবে তার ফ্লো (গাড়ি ভাড়াও এখানে আছে)
- **`NotificationDrawer.astro`** — বেল/ইনবক্স, Realtime সাবস্ক্রিপশন দিয়ে ইন-অ্যাপ নোটিফিকেশন লাইভ দেখায়
- **`NotificationPermissionPrompt.astro`** — নেটিভ push permission পপ-আপের আগে soft-ask মোডাল

সব কাস্টম ইভেন্ট `window` লেভেলে dispatch/listen হয় — কম্পোনেন্টগুলো `BaseLayout.astro`-তে গ্লোবালি একবার মাউন্ট থাকে।

---

## ৫. সার্ভিস ক্যাটাগরি (২০টা — নতুন: `ride`, `clubs`)

`src/data/services.js` — URL প্যাটার্ন: `/services/[slug]`

| বাংলা নাম | Slug | নোট |
|---|---|---|
| বাসা ভাড়া | `housing` | |
| চাকরির খবর | `job` | |
| রিপেয়ার সার্ভিস | `repair` | |
| গাড়ি ভাড়া সার্ভিস | `car-rental` | কাস্টম ডিজাইন |
| ডেলিভারি হিরো | `courier` | কাস্টম ডিজাইন — সেকশন ৭ দেখুন |
| **রাইড হিরো** | `ride` | **নতুন ক্যাটাগরি** — courier-এর মডেল থেকে অ্যাডাপ্ট |
| ইমার্জেন্সি কন্টাক্ট | `emergency` | hidden (নেভিগেশনে দেখায় না, ডাইরেক্ট লিংকে অ্যাক্সেসযোগ্য) |
| ব্লাড ডোনার | `blood` | `is_blood_donor` কলাম শিপড |
| হোম মেস ফুড | `home-food` | hidden |
| অনলাইন শপ | `online-shop` | মাল্টি-ভেন্ডর, কার্ট/চেকআউট সহ |
| **ক্লাব সমূহ** | `clubs` | **নতুন — লিস্টিং না, আলাদা মডিউল** (সেকশন ৭) |
| রিসাইকেল মার্কেট | `recycle` | |
| টিউশন খুঁজুন | `tuition` | |
| খেলাধুলা ও ইভেন্টস | `sports` | |
| লস্ট এন্ড ফাউন্ড | `lost-found` | hidden |
| স্বাস্থ্য পরামর্শ | `health` | hidden, ফর্ম সাবমিশন → admin/health-requests |
| আইনি পরামর্শ | `legal` | hidden, ফর্ম সাবমিশন → admin/legal-requests |
| ইভেন্ট ম্যানেজমেন্ট | `event` | hidden |
| লন্ড্রি সার্ভিস | `laundry` | hidden |
| ডাক্তার ও হাসপাতাল ডিরেক্টরি | `doctor-directory` | hidden |

**✅ ক্লিনআপ সম্পন্ন:** পুরনো orphan ফাইল (cleaning/marriage/used/plumbing/food/lost.astro) রিপো থেকে ডিলিট হয়ে গেছে — জুলাই ব্লুপ্রিন্টের pending আইটেম এখন done।

---

## ৬. কম্পোনেন্ট স্ট্রাকচার (আপডেটেড ফুল ট্রি)

```
src/components/
├── layout/
│   ├── Header.astro
│   ├── BottomNav.astro          — নতুন, সেকশন ৪ দেখুন
│   ├── HamburgerMenu.astro      — নতুন
│   ├── CategoryDrawer.astro     — নতুন
│   ├── PostFlowDrawer.astro     — নতুন
│   ├── NotificationDrawer.astro — নতুন (ইনবক্স + বেল)
│   ├── Footer.astro             — এখন রিয়েল ফোন নম্বর (+8801816355833)
│   └── BaseLayout.astro
├── ui/
│   ├── LocationSelector.astro, Hero.astro, CategoryGrid.astro,
│   │   FeaturedPhotos.astro, AuthModal.astro, AddListingModal.astro
├── shared/
│   ├── CategoryCard.astro, CategoryCardPopular.astro
│   ├── ReportModal.astro
│   └── NotificationPermissionPrompt.astro — নতুন
├── club/                         — নতুন মডিউল (পাবলিক-ফেসিং)
│   ├── ClubProfile.astro, AchievementTimeline.astro, AnnouncementTicker.astro,
│   │   EventSection.astro, GallerySection.astro, JoinRequestForm.astro, MemberGrid.astro
├── club-dashboard/                — নতুন (ক্লাব ওউনার/মডারেটর প্যানেল)
│   ├── BroadcastModal.astro, DonorTab.astro, JoinRequestsInbox.astro,
│   │   MembersCommitteeTab.astro, ModeratorsTab.astro, NotificationsInbox.astro,
│   │   PostsTab.astro, ProfileEditTab.astro
├── shop/                          — নতুন (পাবলিক-ফেসিং)
│   └── ShopProfile.astro
├── shop-dashboard/                — নতুন (শপ ওউনার প্যানেল)
│   ├── ModeratorsTab.astro, OrdersTab.astro, ProductsTab.astro, ProfileEditTab.astro
├── delivery/                      — নতুন (ডেলিভারি/রাইড হিরো)
│   ├── ChatModal.astro, DeliveryHeroCard.astro, RideHeroCard.astro,
│   │   DisputeReasonModal.astro, LocationPicker.astro, OnlineRidersPanel.astro,
│   │   RiderProfileModal.astro, RiderRegisterModal.astro
├── ImageLightbox.astro
└── ChatWidget.astro
```

---

## ৭. নতুন ইকোসিস্টেম মডিউলগুলো

### ৭.১ ক্লাব সিস্টেম (`clubs`)
- পাবলিক ডিরেক্টরি `/clubs` এবং প্রতিটা ক্লাবের ভ্যানিটি URL — `club.smartfeni.com/[slug]` (subdomain rewrite, middleware.ts)
- ক্লাব প্রোফাইল: achievement timeline, announcement ticker, event section, গ্যালারি, মেম্বার গ্রিড, জয়েন রিকোয়েস্ট ফর্ম
- ক্লাব ড্যাশবোর্ড (`my-club.astro`): broadcast, ডোনার ট্যাব, জয়েন রিকোয়েস্ট ইনবক্স, মেম্বার/কমিটি ম্যানেজমেন্ট, মডারেটর, পোস্ট, প্রোফাইল এডিট
- Admin সাইডে `/admin/clubs` থেকে অ্যাপ্রুভাল/ম্যানেজমেন্ট, `api/reassign-club-owner.js`, `api/create-club.js`, `api/delete-club.js`

### ৭.২ শপ সিস্টেম (`online-shop`)
- ইউজার `/become-a-shop-owner` থেকে আবেদন করে (`shop_requests` টেবিল) → admin `/admin/shops`-এ Approve
- শপ প্রোফাইল পাবলিক পেজ (`/shop/[id]`), প্রোডাক্ট পেজ (`/product/[id]`)
- কার্ট + চেকআউট ফ্লো (`cart.astro`, `checkout.astro`), অর্ডার ট্র্যাকিং (`my-orders.astro`)
- শপ ড্যাশবোর্ড (`my-shop.astro`): প্রোডাক্টস, অর্ডারস, মডারেটরস, প্রোফাইল এডিট ট্যাব
- শপ-নির্দিষ্ট Telegram বট ইন্টিগ্রেশন (অর্ডার নোটিফিকেশনের জন্য — `api/shop-telegram-*.js`, Delivery/Ride Hero-র বট (`@Smart_hero_bot`) থেকে আলাদা)

### ৭.৩ ডেলিভারি হিরো ও রাইড হিরো
- **বার্গেনিং-বেসড মডেল:** কাস্টমার রিকোয়েস্ট পোস্ট করে (asking price সহ) → হিরো/রাইডাররা অফার সাবমিট করে → কাস্টমার accept করে
- মূল পেজ: `/delivery-hero`, `/ride-hero` (ride-hero, delivery-hero থেকে অ্যাডাপ্ট করা, একই প্যাটার্ন)
- ১৫ সেকেন্ড পোলিং দিয়ে অটো-রিফ্রেশ, `expireRequests()` silent কল দিয়ে স্টেল রিকোয়েস্ট এক্সপায়ার
- Mutual contact reveal — নাম/কল/হোয়াটসঅ্যাপ শুধু confirmed/delivered অবস্থায় দুইপক্ষকেই দেখানো হয়
- ইন-অ্যাপ চ্যাট (`chatClient.js`) — WhatsApp-এর বিকল্প, RLS-স্কোপড (`is_delivery_chat_participant()`)
- ডিসপিউট সিস্টেম — `DisputeReasonModal.astro`, admin resolve (`/admin/delivery-disputes`)
- রাইডার ভেরিফিকেশন — `/admin/delivery-riders` থেকে verify/delete
- ১৫+ API রুট `src/pages/api/delivery/` এ (create/accept/confirm/cancel/dispute/review ইত্যাদি)
- Payment proof আপলোড ফ্লো (`upload-payment-proof.js`)
- Deep-link সাপোর্ট: `?notif=` প্যারামিটার দিয়ে নোটিফিকেশন থেকে সরাসরি রিলেভেন্ট কার্ডে স্ক্রল

### ৭.৪ লাকি ড্র (`/admin/lucky-draw`)
- Admin-only (moderator ব্লকড, admin গার্ডে extra role চেক)
- ড্র তৈরি (draft) → লাইভ পেজে চালু (`/admin/lucky-draw/[id]/live`) → completed হলে বিজয়ীর তথ্য

### ৭.৫ Telegram বট ইন্টিগ্রেশন
- **`@Smart_hero_bot`** — Delivery/Ride Hero নোটিফিকেশনের জন্য (env: `TELEGRAM_HERO_BOT_TOKEN`)
- আলাদা শপ-অর্ডার বট (per-shop connect flow, `shop-telegram-connect-token.js`)
- Admin bot-chats পেজ (`/admin/bot-chats`) — স্ক্রিনশট পাঠিয়ে Gemini Vision দিয়ে লিস্টিং ডেটা এক্সট্র্যাকশন, ক্যাটাগরি চেকবক্স `geminiExtract.js`-এর `SUPPORTED_CATEGORIES` থেকে অটো আসে

### ৭.৬ স্বাস্থ্য ও আইনি পরামর্শ রিকোয়েস্ট ফর্ম
- `health.astro` / `legal.astro` থেকে ফর্ম সাবমিশন (`api/health-request.ts`, `api/legal-request.ts`)
- Admin ম্যানেজমেন্ট: `/admin/health-requests`, `/admin/legal-requests` — স্ট্যাটাস ফ্লো: pending → contacted → resolved

---

## ৮. Admin প্যানেল (`/admin/`) — আপডেটেড ফুল লিস্ট

`adminGuard.js` ক্লায়েন্ট-সাইড role check, `smartfeni:admin-ready` ইভেন্ট প্যাটার্ন, `id="adminLoadingState"` / `id="adminGuardedContent"` HTML কন্ট্রাক্ট অপরিবর্তিত।

| রুট | ফাংশন |
|---|---|
| `/admin` | ড্যাশবোর্ড ওভারভিউ |
| `/admin/listings` | লিস্টিং মডারেশন (approve/reject/delete) |
| `/admin/users` | ইউজার ম্যানেজমেন্ট (block/unblock) |
| `/admin/moderators` | মডারেটর গ্র্যান্ট/রিভোক (admin-only) |
| `/admin/categories` | ক্যাটাগরি ম্যানেজমেন্ট |
| `/admin/clubs` | ক্লাব অ্যাপ্রুভাল/ম্যানেজমেন্ট — **নতুন** |
| `/admin/shops` | শপ অ্যাপ্রুভাল/ম্যানেজমেন্ট — **নতুন** |
| `/admin/delivery-riders` | রাইডার ভেরিফিকেশন — **নতুন** |
| `/admin/delivery-disputes` | ডিসপিউট রিজলিউশন — **নতুন** |
| `/admin/health-requests` | স্বাস্থ্য পরামর্শ রিকোয়েস্ট — **নতুন** |
| `/admin/legal-requests` | আইনি পরামর্শ রিকোয়েস্ট — **নতুন** |
| `/admin/lucky-draw` | লাকি ড্র ড্যাশবোর্ড — **নতুন** |
| `/admin/bot-chats` | Telegram স্ক্রিনশট এক্সট্র্যাকশন ম্যানেজমেন্ট — **নতুন** |
| `/admin/analytics` | কাস্টম বিজনেস মেট্রিক্স (উপজেলা ট্রাফিক, engagement, কল ক্লিক) — **নতুন**, জেনারেল ট্রাফিকের জন্য GA4 লিংক |
| `/admin/notifications` | ব্রডকাস্ট/ক্যাম্পেইন — **নতুন** |
| `/admin/images` | হাব — `logo`, `header` (৭ স্লট), `featured-photo`, `categories` |
| `/admin/optimize-images` | ইমেজ অপ্টিমাইজেশন টুল — **নতুন** |
| `/admin/seed-locations` | OSM লোকেশন সাজেশন সিড করা — **নতুন** |

---

## ৯. নোটিফিকেশন সিস্টেম — শিপড (৬ ফেজ সম্পূর্ণ)

পূর্ণ আর্কিটেকচার প্ল্যান আলাদা ডকুমেন্টে আছে (`Push notification` প্রজেক্ট ফাইল) — সংক্ষেপে বর্তমান অবস্থা:

- **সোর্স টেবিল** `notification_events`-এর ধাঁচে (`user_notifications`) — insert হলেই `trg_notify_push_on_insert` trigger সাথে সাথে push পাঠায়, আর `NotificationDrawer.astro`-র Realtime subscription ইন-অ্যাপ আপডেট দেখায় — **একই সোর্স থেকে ৩ চ্যানেলে ফ্যান-আউট** (push/inbox/bell), প্ল্যান করা প্যাটার্নই বাস্তবায়িত হয়েছে
- **ডুয়াল push (নতুন, প্ল্যানে ছিল না):**
  - `platform === 'web'` → `web-push` (VAPID)
  - `platform === 'android'` → `firebase-admin` (FCM) — নেটিভ অ্যাপ থেকে
  - Stale subscription cleanup: web-এ 404/410, android-এ FCM-এর `registration-token-not-registered`/`invalid-registration-token` এলে অটো ডিলিট
- **Android notification channel ম্যাপিং** — ক্যাটাগরি অনুযায়ী চ্যানেল (`sf_blood_v1`, `sf_rider_v1`, `sf_delivery_v1`, `sf_orders_v1`, `sf_message_v1`, `sf_updates_v1`, `sf_promo_v1`, `sf_admin_v1`), প্রতিটার priority/TTL আলাদা, `low` priority পাঠানো হয় না
- **নিরাপত্তা:** `/api/push/send` এন্ডপয়েন্টে `X-Internal-Secret` হেডার ভেরিফাই হয় (শুধু Supabase cron/pg_net থেকেই কল আসার কথা)
- **Soft-ask প্রম্পট:** `NotificationPermissionPrompt.astro` — নেটিভ permission popup-এর আগে দেখানো হয়
- `push.js` — ব্রাউজার + নেটিভ (Capacitor `@capacitor/push-notifications`) দুটোই ডিটেক্ট করে সঠিক subscribe path নেয়

⚠️ **সিকিউরিটি নোট:** `dispatch_pending_push_notifications()` ফাংশনে hardcoded secret থাকার এবং এটা পাবলিকলি অ্যাক্সেসযোগ্য থাকার ইস্যু সেপ্টেম্বর ২০২৬ সিকিউরিটি অডিটে ধরা পড়েছে — ফিক্স পেন্ডিং (সেকশন ১৪ দেখুন)।

---

## ১০. AI চ্যাটবট (ChatWidget) ও Gemini ব্যবহার

দুই জায়গায় Gemini API ব্যবহার হয়:

1. **ChatWidget** (`src/components/ChatWidget.astro` + `src/pages/api/chat.ts`) — সাইট সম্পর্কে ইউজারের প্রশ্নের উত্তর দেয়। `SYSTEM_CONTEXT`-এ ক্যাটাগরি লিস্ট + `src/data/chatFeatures.js`-এর নন-ক্যাটাগরি ফিচার (ক্লাব, শপ ইত্যাদি) দুটোই পাঠানো হয় — নতুন বড় ফিচার (ক্যাটাগরি না এমন) যোগ হলে `chatFeatures.js`-এ এন্ট্রি যোগ করলেই চ্যাটবট জেনে যায়, `api/chat.ts` ঘাঁটতে হয় না
2. **`geminiExtract.js`** — Telegram-এ পাঠানো স্ক্রিনশট থেকে লিস্টিং ডেটা এক্সট্র্যাকশন (housing/recycle/job/repair/tuition/sports-এ single object, blood-এ একাধিক ডোনার array) — `admin/bot-chats` ফ্লোর ব্যাকএন্ড

**Gemini মডেল মাইগ্রেশন হিস্ট্রি (গুরুত্বপূর্ণ, technical-learnings.md-এও আছে):** `gemini-2.0-flash` (বন্ধ) → `gemini-2.5-flash` (404) → **`gemini-3.1-flash-lite`** (বর্তমানে কার্যকর)। ভবিষ্যতে আবার এরর দিলে: Vercel logs → Google-এর changelog → `MODEL_NAME` কনস্ট্যান্ট আপডেট।

---

## ১১. Git/Deploy ওয়ার্কফ্লো (মোবাইল-only, Termux নয়)

- SF সম্পূর্ণ **মোবাইল থেকে** কাজ করেন — GitHub মোবাইল অ্যাপ + মোবাইল ব্রাউজার। কোনো Termux/টার্মিনাল অ্যাক্সেস নেই (⚠️ পুরনো ব্লুপ্রিন্টে Termux workflow লেখা ছিল — এটা ভুল/সেকেলে, বাদ)
- `vercel.json`-এ `git.deploymentEnabled` অফ (auto-deploy বন্ধ) — build minutes বাঁচাতে ম্যানুয়াল deployment ব্যাচ করা হয়
- `deploy.sh` স্ক্রিপ্ট দিয়ে সরাসরি Vercel production-এ deploy সম্ভব
- **GitHub Actions (নতুন, ২টা ওয়ার্কফ্লো):**
  - `build-android.yml` — `android/**`, `src/**`, `package.json` ইত্যাদিতে push হলে অটো ট্রিগার (বা ম্যানুয়াল `workflow_dispatch`) — Capacitor sync + signed release AAB বিল্ড করে (keystore secrets দিয়ে সাইন করা)
  - `scrape-cnglagbe.yml` — cnglagbe.com স্ক্র্যাপার শিডিউলড রান

---

## ১২. নেটিভ Android অ্যাপ — Capacitor (⚠️ কারেকশন: PWABuilder/TWA নয়)

**গুরুত্বপূর্ণ সংশোধন:** আগে ধরে নেওয়া হয়েছিল অ্যাপটা PWABuilder দিয়ে বানানো TWA (Trusted Web Activity)। রিপো স্ক্যানে দেখা গেছে এটা আসলে **Capacitor-বেসড নেটিভ Android অ্যাপ** — অনেক বেশি capable, নিচের ফিচারগুলো তাই সম্ভব হয়েছে যা TWA-তে হতো না।

- **`capacitor.config.json`:** `appId: com.smartfeni.app`, সার্ভার URL `https://smartfeni.com` (লাইভ সাইট লোড করে, কিন্তু নেটিভ শেল হওয়ায় নিচের প্লাগিন অ্যাক্সেস আছে)
- **ব্যবহৃত Capacitor প্লাগিন:** `@capacitor/push-notifications` (FCM), `@capacitor/geolocation`, `@capacitor/camera`, `@capacitor/filesystem`, `@capacitor/preferences`, `@capacitor/app`, `@capacitor/splash-screen`
- **`native-bridge.js`** — Capacitor অ্যাপ বনাম ব্রাউজার প্ল্যাটফর্ম ডিটেক্ট করে সঠিক API (নেটিভ প্লাগিন বা ওয়েব API) বেছে নেয়; ওয়েবসাইটে (ব্রাউজারে) এই ফাইল থাকলেও কোনো আচরণ বদলায় না — শুধু অ্যাপের ভেতরে চললেই নেটিভ path নেয়
  - `rememberLastUrl()` — প্রতিটা পেজ ভিজিটে URL নেটিভ Preferences-এ সেভ হয় (key: `sf_last_url`), যাতে ইন্টারনেট না থাকলে/রিস্টার্টে শেষ পেজ থেকে রিজিউম করা যায়
- **`sw.js` (service worker):** এখন কোনো `fetch` হ্যান্ডলার নেই (বাগফিক্স — আগে fetch হ্যান্ডলার থাকায় সাময়িক নেট ফেইলে খালি ক্যাশ ফেরত দিত, `net::ERR_FAILED` দেখাত, Capacitor-এর ব্র্যান্ডেড error page (`www/error.html`) কাজ করত না)। push event handling-এর জন্য 4-tier priority সিস্টেম (urgent/high/normal/low) — প্রতিটার আলাদা vibration pattern
- **Build পাইপলাইন:** GitHub Actions (`build-android.yml`) — `npx cap sync android` → keystore দিয়ে সাইন করা signed release AAB (`gradlew bundleRelease`)
- **`android/`** ফোল্ডার রিপোতে কমিটেড আছে (gradle ফাইল, build.gradle, ইত্যাদি)

### বর্তমান Play Store স্ট্যাটাস (সেপ্টেম্বর ২০২৬)
- ✅ Production access গ্র্যান্টেড
- ✅ Production release সেন্ট ফর রিভিউ (২০ সেপ্টেম্বর ২০২৬, Managed publishing off — approve হলে অটো লাইভ)
- ⚠️ Play Console নোটিশ: DEX code optimization (Obfuscation 2%) — fix by Feb 2027, ব্লকিং না, ভবিষ্যতে `minifyEnabled true` + `shrinkResources true` দিয়ে ঠিক করার সুযোগ আছে
- ⚠️ Edge-to-edge deprecated API সুপারিশ — recommended, blocking না
- 4টা fingerprint (upload key, app signing classical/post-quantum, Fingerprint list পেজ) `.well-known/assetlinks.json.ts`-এ থাকা দরকার (Digital Asset Link verification-এর জন্য — Astro dotfile-copy বাগের কারণে `src/pages/.well-known/assetlinks.json.ts` API route হিসেবে সার্ভ করা হয়, static ফাইল হিসেবে না)

---

## ১৩. Database Schema (Supabase) — জানা টেবিল

> নোট: এটা কোড-রেফারেন্স থেকে চেনা টেবিলের তালিকা, সম্পূর্ণ স্কিমা ডাম্প না। কোনো মাইগ্রেশন করার আগে Supabase MCP দিয়ে `list_tables` চালিয়ে লাইভ স্কিমা কনফার্ম করা উচিত।

**কোর:** `profiles` (role: user/moderator/admin, `is_blocked`, `blood_group`, `upazila`, `is_blood_donor`, `recovery_email`), `listings` (`is_reviewed`), `featured_photos`, `site_images` (`image_key` PK)

**ক্লাব/শপ:** `shop_requests`, শপ/প্রোডাক্ট/অর্ডার-সম্পর্কিত টেবিল (নাম কোডে দেখা যায়নি, কিন্তু API রুট থেকে অস্তিত্ব নিশ্চিত)

**ডেলিভারি/রাইড হিরো:** ৫+ টেবিল (রিকোয়েস্ট, অফার, রিভিউ, চ্যাট মেসেজ, ডিসপিউট) — RLS ফাংশন `is_delivery_chat_participant()`

**নোটিফিকেশন:** `user_notifications` (সোর্স টেবিল), push subscription টেবিল (web + android উভয় প্ল্যাটফর্ম ফিল্ড সহ)

**লাকি ড্র:** `lucky_draws`

**ফাংশন/RLS:**
- `is_admin_or_mod()` — SECURITY DEFINER, RLS পলিসিতে ব্যবহৃত
- `upsert_cnglagbe_listings(rows jsonb)` — cnglagbe স্ক্র্যাপার আপসার্টের জন্য (partial unique index-এর কারণে `.upsert()` সরাসরি কাজ করে না)
- `dispatch_pending_push_notifications()` — cron/pg_net থেকে push ডিসপ্যাচ (⚠️ hardcoded secret ইস্যু, সেকশন ১৪)
- `create_notification()`-টাইপ helper (⚠️ caller validation ইস্যু, সেকশন ১৪)

---

## ১৪. নিরাপত্তা — বর্তমান অবস্থা ও ওপেন ইস্যু

- **CSP:** `vercel.json`-এ `Content-Security-Policy-Report-Only` হেডার আছে (enforce মোডে যায়নি এখনো), সাথে `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (camera/mic বন্ধ, geolocation শুধু self), `Strict-Transport-Security` — এগুলো সবই enforced
- **সেপ্টেম্বর ২০২৬ ফুল-রিপো + Supabase advisor অডিটে পাওয়া ওপেন ইস্যু (ফিক্স পেন্ডিং):**
  1. `create_notification()`-জাতীয় RPC-তে caller validation নেই — যে কেউ যে কাউকে নোটিফিকেশন পাঠাতে পারে
  2. `listings`-এর UPDATE RLS পলিসিতে `WITH CHECK` নেই — owner নিজের লিস্টিং নিজেই approve করতে পারে
  3. Telegram webhook-এ secret token validate হয় না
  4. `dispatch_pending_push_notifications()` পাবলিকলি অ্যাক্সেসযোগ্য + এতে hardcoded secret আছে

বিস্তারিত ফাইন্ডিংস প্রজেক্ট মেমোরির `security-audit-2026-09` ফাইলে আছে।

---

## ১৫. মূল শিক্ষা ও প্রিন্সিপাল (আপডেটেড)

1. **Astro scoped CSS dynamically injected HTML-এ কাজ করে না** — সব dynamic content-এ inline style (`setAttribute("style", ...)`)।
2. **`define:vars` + dynamic import Astro/Vite-এ silent bundling failure দেয়** — স্ট্যাটিক `import` ব্যবহার করতে হবে।
3. **Astro dotfile bug** — `public/.well-known/...` বিল্ডে কপি হয় না, `src/pages/.well-known/....ts` API route দিয়ে সার্ভ করতে হয়।
4. **Supabase Auth-এ ইমেইল বাধ্যতামূলক** — ফোন-only auth-এর জন্য dummy email (`phone@smartfeni.local`)।
5. **বিদেশ থেকে GPS auto-detection** — Haversine + 40km threshold।
6. **Vercel-এর 4.5MB body limit** — হাই-রেজ ছবি (Samsung ইত্যাদি) সরাসরি আপলোডে আটকে যেত, `imageCompress.js` দিয়ে client-side canvas কম্প্রেশন যোগ করে ফিক্স।
7. **Gemini/থার্ড-পার্টি AI মডেল দ্রুত ডিপ্রিকেট হয়** — মডেল নেম এক জায়গায় কনস্ট্যান্ট রাখা, এরর দিলে Vercel logs + official changelog আগে চেক করা।
8. **Multiple GoTrueClient instances** — ৪৪+ কম্পোনেন্ট আলাদাভাবে supabase.js ইমপোর্ট করায় `refresh_token_not_found` এরর হতো, globalThis singleton guard দিয়ে ফিক্স।
9. **RLS cross-table recursion** — policy-তে টেবিল রেফারেন্স রিকার্সিভ হলে query-টাইমে infinite recursion, SECURITY DEFINER ফাংশন দিয়ে ফিক্স।
10. **Native bridge platform detection প্যাটার্ন** — একই কোডবেস ওয়েব ও Capacitor অ্যাপে চলে, `native-bridge.js`/`push.js`-এ `isNativeApp()` চেক দিয়ে সঠিক API path বেছে নেওয়া হয় — নতুন নেটিভ-নির্ভর ফিচারেও এই প্যাটার্ন অনুসরণ করা উচিত।
11. **club.smartfeni.com subdomain rewrite** middleware-এ হোস্টনেম চেক করে করা হয় — নতুন সাবডোমেইন লাগলে একই প্যাটার্নে middleware.ts এক্সটেন্ড করা যাবে।

---

## ১৬. পেন্ডিং/ভবিষ্যৎ টাস্ক লিস্ট (রিফ্রেশড)

- [ ] Security audit ফিক্স ৪টা (সেকশন ১৪) — `create_notification()` caller check, listings UPDATE `WITH CHECK`, Telegram webhook secret validation, `dispatch_pending_push_notifications()` অ্যাক্সেস + hardcoded secret
- [ ] Listing self-management: এডিট করা approved লিস্টিং আবার pending-এ রিসেট হয় না (admin re-review flag মিসিং) — এডিটেড কন্টেন্ট মডারেশন বাইপাস করে
- [ ] Duplicate phone number দিয়ে একাধিক auth অ্যাকাউন্ট তৈরি সম্ভব — আনরিজলভড
- [ ] Custom domain (smartfeni.com) মাঝে মাঝে stale Vercel edge cache দেখাতে পারে (.vercel.app-এ হয় না) — আনরিজলভড
- [ ] CSP header এখনো Report-Only মোডে — এনফোর্স করার আগে রিপোর্ট রিভিউ করা দরকার
- [ ] Footer email এখনো generic (`info@smartfeni.com`) — ফোন নম্বর রিয়েল হয়ে গেছে
- [ ] নোটিফিকেশন nice-to-have: গ্রুপিং, quiet hours, weekly digest, mute conversation, delivery confirmation UI (Sent/Delivered/Seen)
- [ ] Play Store: DEX optimization/obfuscation percentage বাড়ানো (fix by Feb 2027) — পরের AAB বিল্ডে `minifyEnabled`/`shrinkResources`
- [ ] ChatWidget থাম্বস আপ/ডাউন ফিডব্যাক এখনো client-side only, ব্যাকএন্ডে সংরক্ষণ হয় না

---

## ১৭. Claude-এর সাথে কাজ করার নিয়ম (রেফারেন্স — অপরিবর্তিত)

1. কোনো কোড পরিবর্তনের আগে প্ল্যান বলা, কোড পরে — ইউজার "ঠিক আছে/ok" বললে তারপর কোড
2. কোড সবসময় সম্পূর্ণ ফাইল আকারে (diff/partial edit না), ফাইলের পুরো পাথ উল্লেখ করে
3. একবারে একটা ফাইল, "ok" বললে পরের ফাইলে যাওয়া
4. ছবি/অ্যাসেট লাগলে সাইজ, ফরম্যাট, ফাইলনেম ও ঠিক কোন `public/...` পাথে বসাতে হবে তা স্পষ্ট করে বলা
5. প্রতিটা ফাইল পরিবর্তনের পর সংক্ষেপে কী কী বদলেছে বলা
6. Claude-এর GitHub-এ সরাসরি write access নেই — ইউজারকেই কপি-পেস্ট/কমিট করতে হয়
7. সব যোগাযোগ বাংলা/বাংলিশে
8. যেকোনো নতুন আপডেট নিয়ে কথা বললে প্রথমে কোন কোন ফাইল লাগবে তা বলা; ইউজার আলাদাভাবে ফাইল আপডেট করে থাকলে, ইউজার কারেন্ট কোড দেওয়ার পর সেটা দেখে নতুন আপডেট করা

---

*এই ডকুমেন্ট প্রজেক্টের evolving reference — বড় কোনো ফিচার/আর্কিটেকচার পরিবর্তনের পর এটাও আপডেট করে রাখা উচিত।*
