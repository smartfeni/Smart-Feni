// ============================================================
// src/data/categoryColors.js — ক্যাটাগরি অনুযায়ী রং (শেয়ার্ড)
// CategoryDrawer, PostFlowDrawer (ও পরে যেকোনো জায়গায়) একই রং ব্যবহার করে।
// ব্যবহার: style={`--c:${categoryColor(cat.slug)}`} — CSS এ color-mix(in srgb, var(--c) 14%, #fff)
// নতুন ক্যাটাগরি যোগ হলে এখানে slug/id দিয়ে একটা লাইন যোগ করলেই হবে;
// না দিলে ডিফল্ট কমলা (#FF6B35) আসে।
// ============================================================

export const DEFAULT_CATEGORY_COLOR = '#FF6B35';

export const categoryColors = {
  housing: '#3B82F6',
  job: '#16A34A',
  repair: '#F59E0B',
  'car-rental': '#8B5CF6',
  courier: '#FF6B35',
  ride: '#6366F1',
  emergency: '#DC2626',
  blood: '#EF4444',
  'home-food': '#EA580C',
  'online-shop': '#EC4899',
  clubs: '#0EA5E9',
  club: '#0EA5E9',
  recycle: '#10B981',
  tuition: '#F97316',
  sports: '#14B8A6',
  'lost-found': '#64748B',
  health: '#0D9488',
  legal: '#475569',
  event: '#D946EF',
  laundry: '#06B6D4',
  'doctor-directory': '#0891B2',
};

export function categoryColor(key) {
  return categoryColors[key] || DEFAULT_CATEGORY_COLOR;
}
