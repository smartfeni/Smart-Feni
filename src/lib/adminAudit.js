// ============================================================
// অ্যাডমিন অ্যাক্টিভিটি লগ — সার্ভারের API রুট থেকে (service role)
//
// ডাটাবেসের zz_admin_audit ট্রিগার অ্যাডমিন/মডারেটরের সরাসরি কাজ নিজেই লেখে।
// কিন্তু service role দিয়ে চলা API রুটে auth.uid() থাকে না, তাই ট্রিগার বুঝতে পারে না
// কে করল। এসব রুটে কাজ সফল হলে এই ফাংশন আসল মানুষের নামে লগ লেখে
// (public.log_admin_action, শুধু service_role চালাতে পারে)।
//
// ব্যবহার:
//   await logAdminAction(supabaseAdmin, {
//     actorId: callerUser.id, action: 'delete', entity: 'clubs',
//     entityId: clubId, label: club.name, details: { owner_id: club.owner_id },
//   });
// action: create | edit | approve | reject | delete | role | other
// লগ লিখতে সমস্যা হলেও কখনো throw করে না — আসল কাজ আটকাবে না।
// ============================================================

export async function logAdminAction(db, { actorId, action, entity, entityId = null, label = null, details = null }) {
  if (!db || !actorId || !action || !entity) return;
  try {
    const { error } = await db.rpc('log_admin_action', {
      p_actor_id: actorId,
      p_action: action,
      p_entity: entity,
      p_entity_id: entityId == null ? null : String(entityId),
      p_entity_label: label == null ? null : String(label),
      p_details: details,
    });
    if (error) console.warn('[adminAudit] log_admin_action ব্যর্থ:', error.message);
  } catch (err) {
    console.warn('[adminAudit] log_admin_action ব্যর্থ:', err && err.message);
  }
}
