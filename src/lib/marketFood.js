// খাবার ধরনের ক্যাটাগরি (খাবার, বেকারি ও কেক): এসব দোকানে "মেনু" আর ঝাল/জনপ্রিয়/নতুন ট্যাগ।
// বাকি সব দোকানে "প্রোডাক্ট", ট্যাগ নেই।
export const FOOD_CAT_IDS = ['acc8fdec-0db1-41c9-bdbf-e20c5d6ed2dd', '5cfb21a4-e1b0-4f18-ad2c-e3e66b436c5c'];
export function isFoodShop(catIds) {
  const ids = Array.isArray(catIds) ? catIds : [];
  if (!ids.length) return true; // ক্যাটাগরি না থাকলে আগের মতো
  return ids.some((x) => FOOD_CAT_IDS.indexOf(String(x)) !== -1);
}
export function menuWord(catIds) { return isFoodShop(catIds) ? 'মেনু' : 'প্রোডাক্ট'; }
