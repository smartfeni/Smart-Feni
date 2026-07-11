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
//     const { role, profile } = e.detail;
//     // role === 'admin' হলে extra কিছু দেখাতে চাইলে এখানে লজিক লিখুন
//   });
// ============================================================

import { supabase } from './supabase.js';

export async function initAdminGuard({ redirectTo = '/' } = {}) {
  const loadingEl = document.getElementById('adminLoadingState');
  const contentEl = document.getElementById('adminGuardedContent');

  function denyAccess() {
    window.location.href = redirectTo;
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

  // ===== অ্যাক্সেস অনুমোদিত =====
  if (loadingEl) loadingEl.style.display = 'none';
  if (contentEl) contentEl.style.display = '';

  const detail = { role: profile.role, profile, session };
  window.dispatchEvent(new CustomEvent('smartfeni:admin-ready', { detail }));

  return detail;
}