// ============================================================
// অ্যাডমিন গার্ড — প্রতিটা /admin/* পেজে ব্যবহার হবে
// ============================================================
// HTML কন্ট্রাক্ট (প্রতিটা admin পেজে এই দুইটা এলিমেন্ট থাকতে হবে):
//   <div id="adminLoadingState">...লোডিং স্পিনার/টেক্সট...</div>
//   <div id="adminGuardedContent" style="display:none;">...আসল কন্টেন্ট...</div>
//
// ব্যবহার (পেজের <script> ট্যাগে):
//   import { initAdminGuard } from '../../lib/adminGuard.js';
//   initAdminGuard();
//   window.addEventListener('smartfeni:admin-ready', (e) => {
//     const { role, profile, access } = e.detail;
//     // role === 'admin' হলে extra কিছু দেখাতে চাইলে এখানে লজিক লিখুন
//     // access.can('listings.manage') — রোল-ভিত্তিক permission চেক
//   });
//
// রোল সিস্টেম (অক্টোবর ২০২৬):
//   - role='admin'          → সব পারে (সুপার অ্যাডমিন)
//   - role='moderator' + admin_staff রো থাকলে → শুধু রোলের permission (access.isStaff = true)
//   - role='moderator' কিন্তু রোল নেই        → আগের মতো পুরো অ্যাক্সেস (legacy)
//   - স্টাফের event.detail.role সবসময় 'moderator' (পেজের পুরনো admin-only অংশ লুকানো থাকে)
//   - my_admin_access() ফেইল করলে পুরনো আচরণে ফিরে যায়, কাউকে লক-আউট করে না
//   - স্টাফের জন্য ম্যাপে না থাকা পেজ (যেমন /admin/roles, /admin/moderators) ডিফল্টে বন্ধ
// ============================================================

import { supabase } from './supabase.js';

// /admin/<segment> → permission এলাকা (admin_permissions.area)
const AREA_BY_SEGMENT = {
  'listings': 'listings',
  'categories': 'categories',
  'images': 'images',
  'optimize-images': 'images',
  'notifications': 'notifications',
  'emergency-contacts': 'emergency',
  'users': 'users',
  'clubs': 'clubs',
  'shops': 'shops',
  'delivery-riders': 'riders',
  'delivery-shops': 'delivery_shops',
  'delivery-orders': 'delivery_orders',
  'delivery-disputes': 'disputes',
  'health-requests': 'health_requests',
  'legal-requests': 'legal_requests',
  'doctors': 'doctors',
  'clinics': 'clinics',
  'referrals': 'referrals',
  'analytics': 'analytics',
  'bot-chats': 'bot_chats',
  'errors': 'errors',
  'devices': 'devices',
  'manual-orders': 'manual_orders',
  'lucky-draw': 'lucky_draw',
};

// '/admin/doctors?x=1' বা '/admin/doctors/abc' → 'doctors'; অজানা পেজ → null
export function adminAreaOfPath(pathOrHref) {
  const m = String(pathOrHref || '').match(/^\/admin\/([^/?#]+)/);
  return m ? (AREA_BY_SEGMENT[m[1]] || null) : null;
}

function openAccess(role) {
  return {
    isAdmin: role === 'admin',
    isStaff: false,
    legacy: role === 'moderator',
    roleName: null,
    permissions: [],
    can: () => true,
  };
}

async function loadAccess(role) {
  const open = openAccess(role);
  if (role === 'admin') return open;
  try {
    const { data, error } = await supabase.rpc('my_admin_access');
    if (error || !data || !data.is_staff) return open;
    const perms = Array.isArray(data.permissions) ? data.permissions : [];
    const set = new Set(perms);
    const can = (key) => {
      if (set.has(key)) return true;
      // .manage থাকলে .view-ও আছে ধরা হয় (DB has_permission-এর নিয়ম)
      if (typeof key === 'string' && key.endsWith('.view')) {
        return set.has(key.slice(0, -5) + '.manage');
      }
      return false;
    };
    return {
      isAdmin: false,
      isStaff: true,
      legacy: false,
      roleName: data.role_name || null,
      permissions: perms,
      can,
    };
  } catch (_) {
    return open;
  }
}

export async function initAdminGuard({ redirectTo = '/' } = {}) {
  const loadingEl = document.getElementById('adminLoadingState');
  const contentEl = document.getElementById('adminGuardedContent');

  function denyAccess(to) {
    window.location.href = to || redirectTo;
  }

  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    denyAccess();
    return null;
  }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, role, is_blocked')
    .eq('id', session.user.id)
    .single();

  if (error || !profile) {
    denyAccess();
    return null;
  }

  if (profile.is_blocked) {
    denyAccess();
    return null;
  }

  if (profile.role !== 'admin' && profile.role !== 'moderator') {
    denyAccess();
    return null;
  }

  const access = await loadAccess(profile.role);

  // রোলওয়ালা স্টাফ: পেজের এলাকায় .view না থাকলে (বা পেজ ম্যাপে না থাকলে) ড্যাশবোর্ডে ফেরত
  if (access.isStaff) {
    const seg = window.location.pathname.replace(/\/+$/, '').match(/^\/admin\/([^/]+)/);
    if (seg) {
      const area = AREA_BY_SEGMENT[seg[1]] || null;
      if (!area || !access.can(area + '.view')) {
        denyAccess('/admin');
        return null;
      }
    }
  }

  // ===== অ্যাক্সেস অনুমোদিত =====
  if (loadingEl) loadingEl.style.display = 'none';
  if (contentEl) contentEl.style.display = '';

  window.__sfAdminAccess = access;
  const detail = { role: profile.role, profile, session, access };
  window.dispatchEvent(new CustomEvent('smartfeni:admin-ready', { detail }));

  return detail;
}
