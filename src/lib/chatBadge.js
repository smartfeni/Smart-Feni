// ============================================================
// ডেলিভারি/রাইড হিরো চ্যাট বাটনে "নতুন মেসেজ" ব্যাজ (১, ২, ৩ ... ৯+)
//
// কীভাবে কাজ করে:
// - পেজে data-chat-request-id আছে এমন যেকোনো <button> (ডেলিভারি হিরো/রাইড হিরোর
//   .dh-chat-btn আর কাস্টমারের my-orders এর .order-chat-btn) এলেই MutationObserver
//   নিজে থেকে ধরে তাতে লাল ব্যাজ বসায় — কার্ড প্রতি ১৫ সেকেন্ডে নতুন করে আঁকা হলেও
//   ব্যাজ আবার বসে যায়, পেজ ফাইলে আলাদা কোড লাগে না
// - সংখ্যা আসে chatClient.getUnreadCount() থেকে (অন্য পক্ষের পাঠানো, is_read=false)
// - delivery_chat_messages এ নতুন মেসেজ INSERT হলে (Realtime, RLS মেনে — শুধু নিজের
//   চ্যাটের মেসেজই আসে) ওই রিকোয়েস্টের সংখ্যা আবার আনা হয়
// - চ্যাট খুললে ব্যাজ সাথে সাথে মুছে যায় (ChatModal নিজেই মেসেজ "পড়া হয়েছে" মার্ক করে)
//
// স্টাইল inline — কার্ড ডাইনামিক HTML দিয়ে আঁকা হয় বলে Astro এর scoped CSS এখানে
// কাজ করে না (প্রজেক্টের পুরনো শিক্ষা)।
// ============================================================

import { supabase } from './supabase.js';
import { getUnreadCount } from './chatClient.js';

const SELECTOR = 'button[data-chat-request-id]';

const badgesByRequest = new Map(); // requestId -> Set<badge span>
const lastCounts = new Map(); // requestId -> সর্বশেষ জানা সংখ্যা (রি-রেন্ডারে ঝিলিক এড়াতে)
const refreshTimers = new Map();

let started = false;
let channel = null;
let myUserId = null;

const BADGE_STYLE = [
  'position:absolute',
  'top:-7px',
  'right:-5px',
  'min-width:20px',
  'height:20px',
  'padding:0 5px',
  'box-sizing:border-box',
  'border-radius:10px',
  'background:#D14343',
  'color:#fff',
  'font-size:11px',
  'font-weight:800',
  'line-height:1',
  'align-items:center',
  'justify-content:center',
  'box-shadow:0 0 0 2px #fff',
  'pointer-events:none',
  'display:none',
].join(';');

function paint(badge, count) {
  if (count > 0) {
    badge.textContent = count > 9 ? '9+' : String(count);
    badge.style.display = 'flex';
  } else {
    badge.textContent = '';
    badge.style.display = 'none';
  }
}

function liveBadges(requestId) {
  const set = badgesByRequest.get(requestId);
  if (!set) return [];
  set.forEach((el) => {
    if (!el.isConnected) set.delete(el);
  });
  if (set.size === 0) {
    badgesByRequest.delete(requestId);
    return [];
  }
  return Array.from(set);
}

async function refresh(requestId) {
  const badges = liveBadges(requestId);
  if (badges.length === 0) return;
  const count = await getUnreadCount(requestId);
  lastCounts.set(requestId, count);
  liveBadges(requestId).forEach((el) => paint(el, count));
}

function scheduleRefresh(requestId, delay) {
  clearTimeout(refreshTimers.get(requestId));
  refreshTimers.set(requestId, setTimeout(() => refresh(requestId), delay));
}

async function ensureChannel() {
  if (channel) return;
  const { data: { user } } = await supabase.auth.getUser();
  myUserId = user?.id || null;

  channel = supabase
    .channel('sf-chat-badges')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'delivery_chat_messages' },
      (payload) => {
        const row = payload.new;
        if (!row || row.sender_id === myUserId) return;
        // ১ সেকেন্ড পরে আনা হয় — চ্যাট খোলা থাকলে ChatModal ততক্ষণে মেসেজটা
        // "পড়া" মার্ক করে ফেলে, তাই সংখ্যা ঠিক থাকে
        scheduleRefresh(row.request_id, 1000);
      }
    )
    .subscribe();
}

function decorate(btn) {
  if (btn.dataset.sfBadge) return;
  const requestId = btn.dataset.chatRequestId;
  if (!requestId) return;
  btn.dataset.sfBadge = '1';

  if (getComputedStyle(btn).position === 'static') {
    btn.style.position = 'relative';
  }

  const badge = document.createElement('span');
  badge.className = 'sf-chat-badge';
  badge.setAttribute('aria-label', 'নতুন মেসেজ');
  badge.setAttribute('style', BADGE_STYLE);
  btn.appendChild(badge);

  if (!badgesByRequest.has(requestId)) badgesByRequest.set(requestId, new Set());
  badgesByRequest.get(requestId).add(badge);

  // আগের জানা সংখ্যা দিয়ে সাথে সাথে আঁকা, তারপর নতুন করে আনা
  paint(badge, lastCounts.get(requestId) || 0);

  // চ্যাট খুললে ব্যাজ সাথে সাথে মুছে যাবে; একটু পরে আসল সংখ্যা আবার মিলিয়ে নেওয়া
  btn.addEventListener('click', () => {
    lastCounts.set(requestId, 0);
    liveBadges(requestId).forEach((el) => paint(el, 0));
    scheduleRefresh(requestId, 1500);
  });

  ensureChannel();
  refresh(requestId);
}

function scan(root) {
  if (root.matches?.(SELECTOR)) decorate(root);
  root.querySelectorAll?.(SELECTOR).forEach(decorate);
}

export function initChatBadges() {
  if (started || typeof document === 'undefined') return;
  started = true;

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      m.addedNodes.forEach((node) => {
        if (node.nodeType === 1) scan(node);
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  scan(document.body);
}
