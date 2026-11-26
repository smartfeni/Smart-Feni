// ============================================================
// Smart Feni Admin (/console) — গার্ড, হেডার প্রোফাইল ও শেয়ার্ড হেল্পার
//
// ConsoleShell.astro একবার initConsole() চালায়। পেজগুলো:
//   import { onConsoleReady } from '../../lib/consoleApp.js';
//   onConsoleReady(({ profile, access, isSuper }) => { ...পেজ লোড... });
//
// নিয়ম: অ্যাডমিন (role=admin) ও মডারেটর ঢুকতে পারে; স্টাফের অনুমতি access.can(...)
// (adminGuard.js-এর loadAccess, পুরনো প্যানেলের হুবহু নিয়ম)। লগইন না থাকলে
// /console/login?next=... (অ্যাডমিন ব্র্যান্ডের লগইন, লজিক proLogin.js)। পুরনো /admin প্যানেল অপরিবর্তিত।
// ============================================================
import { supabase } from './supabase.js';
import { loadAccess, adminAreaOfPath } from './adminGuard.js';

const BN = '০১২৩৪৫৬৭৮৯';
export const bn = (v) => String(v).replace(/\d/g, (d) => BN[d]);

let readyData = null;
const waiters = [];

export function onConsoleReady(cb) {
  if (readyData) cb(readyData);
  else waiters.push(cb);
}

// স্টাফ কোনো পুরনো /admin পেজ দেখতে পারে কিনা (অজানা এলাকা = শুধু সুপার অ্যাডমিন)
export function canOpenAdminPath(href, data, adminOnly = false) {
  if (!data) return false;
  if (data.isSuper) return true;
  if (adminOnly) return false;
  if (!data.access.isStaff) return true; // রোলহীন পুরনো মডারেটর: আগের মতো পুরো অ্যাক্সেস
  const area = adminAreaOfPath(href);
  return !!area && data.access.can(area + '.view');
}

function show(id) {
  ['csGateLoading', 'csGateDenied', 'csContent'].forEach((x) => {
    const el = document.getElementById(x);
    if (el) el.hidden = x !== id;
  });
}

function fillProfile(profile, designation) {
  const name = profile.full_name || 'নাম নেই';
  document.querySelectorAll('[data-cs-name]').forEach((el) => { el.textContent = name; });
  document.querySelectorAll('[data-cs-role]').forEach((el) => { el.textContent = designation; });
  document.querySelectorAll('[data-cs-avatar]').forEach((box) => {
    box.textContent = '';
    if (profile.avatar_url && /^https:\/\//.test(profile.avatar_url)) {
      const img = document.createElement('img');
      img.src = profile.avatar_url;
      img.alt = '';
      img.decoding = 'async';
      img.onerror = () => { img.remove(); box.textContent = name.trim().charAt(0); };
      box.appendChild(img);
    } else {
      box.textContent = name.trim().charAt(0);
    }
  });
}

// লগআউট: [data-cs-logout] বাটনে (মেনুর নিচে ও "অ্যাক্সেস নেই" পেজে); নিশ্চিত করে /console/login-এ
export async function consoleLogout() {
  if (!window.confirm('লগআউট করবেন?')) return;
  try { await supabase.auth.signOut(); } catch (_) { /* উপেক্ষা */ }
  window.location.replace('/console/login');
}

export async function initConsole() {
  if (window.__consoleInit) return;
  window.__consoleInit = true;
  document.addEventListener('click', (e) => {
    const b = e.target instanceof Element ? e.target.closest('[data-cs-logout]') : null;
    if (b) { e.preventDefault(); consoleLogout(); }
  });
  show('csGateLoading');

  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.replace('/console/login?next=' + encodeURIComponent(location.pathname + location.search));
    return;
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_blocked, avatar_url')
    .eq('id', session.user.id)
    .single();

  if (error || !profile || profile.is_blocked || !['admin', 'moderator'].includes(profile.role)) {
    show('csGateDenied');
    return;
  }

  const access = await loadAccess(profile.role);
  const isSuper = profile.role === 'admin';
  const designation = isSuper ? 'সুপার অ্যাডমিন' : (access.roleName || 'মডারেটর');
  fillProfile(profile, designation);

  readyData = { profile, access, isSuper, designation };

  // সুপার-অ্যাডমিন-একমাত্র লিংক ও অনুমতিহীন ট্যাব লুকানো
  document.querySelectorAll('[data-cs-super]').forEach((el) => { el.hidden = !isSuper; });
  document.querySelectorAll('[data-cs-admin-href]').forEach((el) => {
    el.hidden = !canOpenAdminPath(el.getAttribute('data-cs-admin-href'), readyData);
  });

  show('csContent');
  waiters.splice(0).forEach((cb) => { try { cb(readyData); } catch (e) { console.error(e); } });

  refreshTodoBadge();
  setInterval(() => { if (document.visibilityState === 'visible') refreshTodoBadge(); }, 120000);
}

// নিচের "করণীয়" ট্যাবে মোট অপেক্ষার সংখ্যা (admin_todo, অনুমতি অনুযায়ী)
async function refreshTodoBadge() {
  try {
    const { data } = await supabase.rpc('admin_todo', { p_limit: 1 });
    const counts = (data && data.counts) || {};
    const total = Object.values(counts).reduce((s, v) => s + (Number(v) || 0), 0);
    document.querySelectorAll('[data-cs-todo-badge]').forEach((b) => {
      b.textContent = total > 99 ? '৯৯+' : bn(total);
      b.hidden = total === 0;
    });
  } catch (_) { /* উপেক্ষা */ }
}

// ---------- তারিখ/সময় ----------
export function dayLabel(d) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  const diff = Math.round((t - x) / 86400000);
  if (diff === 0) return 'আজ';
  if (diff === 1) return 'গতকাল';
  return new Date(d).toLocaleDateString('bn-BD', { weekday: 'long', day: 'numeric', month: 'long' });
}

export function timeLabel(d) {
  return new Date(d).toLocaleTimeString('bn-BD', { hour: 'numeric', minute: '2-digit' });
}

export function agoLabel(d) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return 'এইমাত্র';
  if (s < 3600) return bn(Math.floor(s / 60)) + ' মিনিট আগে';
  if (s < 86400) return bn(Math.floor(s / 3600)) + ' ঘণ্টা আগে';
  return dayLabel(d) + ', ' + timeLabel(d);
}

// ---------- অ্যাক্টিভিটি লগের লেখা ----------
export const ENTITY_BN = {
  listings: 'লিস্টিং', doctors: 'ডাক্তার', doctor_chambers: 'ডাক্তারের চেম্বার', clinics: 'ক্লিনিক',
  clinic_reps: 'ক্লিনিক প্রতিনিধি', clinic_rep_requests: 'প্রতিনিধি আবেদন', clubs: 'ক্লাব',
  club_requests: 'ক্লাব আবেদন', club_posts: 'ক্লাব পোস্ট', club_members: 'ক্লাব সদস্য',
  market_shop_applications: 'শপ আবেদন', content_reports: 'রিপোর্ট', profiles: 'ইউজার',
  admin_staff: 'স্টাফ', admin_roles: 'রোল', delivery_shops: 'শপ', delivery_shop_items: 'শপের পণ্য',
  delivery_shop_staff: 'শপ স্টাফ', delivery_riders: 'রাইডার', manual_riders: 'ম্যানুয়াল রাইডার',
  manual_orders: 'ম্যানুয়াল অর্ডার', delivery_requests: 'ডেলিভারি অর্ডার',
  delivery_market_categories: 'মার্কেট ক্যাটাগরি', delivery_fare_settings: 'ভাড়ার সেটিং',
  delivery_fare_overrides: 'বিশেষ ভাড়া', withdraw_requests: 'উইথড্র', withdraw_documents: 'উইথড্র ডকুমেন্ট',
  rider_cash_entries: 'রাইডারের ক্যাশ', scratch_config: 'স্ক্রেচ কার্ড সেটিং', lucky_draws: 'লাকি ড্র',
  site_settings: 'সাইট সেটিং', emergency_contacts: 'জরুরি নম্বর', featured_photos: 'ফিচার্ড ছবি',
  category_settings: 'ক্যাটাগরি সেটিং', category_images: 'ক্যাটাগরির ছবি', site_images: 'সাইটের ছবি',
  tutorial_videos: 'টিউটোরিয়াল', manual_blood_donors: 'রক্তদাতা', blood_requests: 'রক্তের রিকোয়েস্ট',
  guest_promos: 'গেস্ট ব্রডকাস্ট',
};

export const ACTION_META = {
  approve: { verb: 'অনুমোদন করেছেন', tag: 'অনুমোদন', bg: '#E7F4EC', fg: '#17663F' },
  reject: { verb: 'রিজেক্ট করেছেন', tag: 'রিজেক্ট', bg: '#FDEEE6', fg: '#B23A0B' },
  edit: { verb: 'এডিট করেছেন', tag: 'এডিট', bg: '#EEF1F5', fg: '#3D4A60' },
  create: { verb: 'তৈরি করেছেন', tag: 'তৈরি', bg: '#E8F0FB', fg: '#1F4F8F' },
  delete: { verb: 'মুছেছেন', tag: 'ডিলিট', bg: '#FBE9EC', fg: '#A3243A' },
  role: { verb: 'রোল বদলেছেন', tag: 'রোল', bg: '#F1ECFA', fg: '#5B3A9A' },
  other: { verb: 'কাজ করেছেন', tag: 'অন্যান্য', bg: '#EEF1F5', fg: '#3D4A60' },
};

const FIELD_BN = {
  status: 'অবস্থা', title: 'শিরোনাম', name: 'নাম', name_bn: 'নাম', full_name: 'নাম', price: 'দাম',
  role: 'রোল', phone: 'ফোন', is_verified: 'ভেরিফাইড', verified: 'ভেরিফাইড', is_active: 'চালু',
  is_blocked: 'ব্লক', description: 'বিবরণ', owner_id: 'মালিক', reject_reason: 'রিজেক্টের কারণ',
  reason: 'কারণ', upazila: 'উপজেলা', value: 'মান', images: 'ছবি', type: 'ধরন',
};

const VALUE_BN = {
  active: 'চালু', pending: 'অপেক্ষায়', rejected: 'রিজেক্ট', approved: 'অনুমোদিত', accepted: 'গৃহীত',
  verified: 'ভেরিফাইড', cancelled: 'বাতিল', completed: 'সম্পন্ন', delivered: 'ডেলিভারি হয়েছে',
  admin: 'সুপার অ্যাডমিন', moderator: 'মডারেটর', user: 'সাধারণ ইউজার',
};

function valueText(v) {
  if (v === null || v === undefined || v === '') return '—';
  if (v === true) return 'হ্যাঁ';
  if (v === false) return 'না';
  if (typeof v === 'object') return Array.isArray(v) ? bn(v.length) + 'টা' : 'বদলেছে';
  const s = String(v);
  return VALUE_BN[s] || (s.length > 80 ? s.slice(0, 80) + '…' : s);
}

// changes/details jsonb → [{ field, from, to }] অথবা [{ field, value }]
export function diffRows(changes) {
  if (!changes || typeof changes !== 'object') return [];
  return Object.keys(changes).map((k) => {
    const v = changes[k];
    const field = FIELD_BN[k] || k;
    if (v && typeof v === 'object' && !Array.isArray(v) && ('from' in v || 'to' in v)) {
      return { field, from: valueText(v.from), to: valueText(v.to) };
    }
    return { field, value: valueText(v) };
  });
}

// site_settings-এর key → বাংলা নাম (লগে দেখানোর জন্য)
const SETTING_BN = {
  accept_delivery_orders: 'ডেলিভারি অর্ডার নেওয়া', accept_local_ride: 'লোকাল রাইড নেওয়া',
  accept_ride_orders: 'রাইড অর্ডার নেওয়া', marketplace_enabled: 'কুইক ডেলিভারি মার্কেট',
  delivery_auto_publish_minutes: 'অটো-পাবলিশ টাইমার', delivery_rider_scope: 'রাইডারের অর্ডার এলাকা',
  shop_notify_on_rider_confirm: 'পিকআপের আগে কনফার্ম', market_commission_pct: 'সাধারণ কমিশন',
  market_payment_bkash: 'অফিসের বিকাশ নম্বর', market_payment_nagad: 'অফিসের নগদ নম্বর',
  market_advance_receiver: 'অগ্রিম কে নেবে', homepage_section_order: 'হোমপেজের সেকশনের ক্রম',
};

export function entityLabel(r) {
  if (r && r.entity === 'site_settings') return SETTING_BN[r.entity_label] || r.entity_label;
  return r ? r.entity_label : '';
}
