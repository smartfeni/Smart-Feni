// ============================================================
// সার্ভার API রুটের জন্য রোল-ভিত্তিক অনুমতি যাচাই
// service-role client-এ auth.uid() থাকে না, তাই ডাটাবেসের
// has_permission_for(uid, key) ফাংশন ব্যবহার হয় (শুধু service_role চালাতে পারে)।
//   - সুপার অ্যাডমিন (role=admin) সবসময় true
//   - স্টাফ (role=moderator + admin_staff রোল) শুধু রোলে থাকা permission পায়
//   - ব্লকড/অন্য সবাই false
// ব্যবহার:
//   if (!(await callerCan(supabaseAdmin, userId, 'shops.manage'))) { ...403... }
// ============================================================

export async function callerCan(supabaseAdmin, userId, permissionKey) {
  if (!supabaseAdmin || !userId || !permissionKey) return false;
  try {
    const { data, error } = await supabaseAdmin.rpc('has_permission_for', {
      p_uid: userId,
      p_key: permissionKey,
    });
    return !error && data === true;
  } catch (_) {
    return false;
  }
}
