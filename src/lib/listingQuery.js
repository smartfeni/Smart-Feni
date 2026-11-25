// ============================================================
// Smart Feni — লিস্টিং ক্যাটাগরি পেজের শেয়ার্ড পেজিনেশন কোয়েরি (সার্ভার-সাইড)
//
// আগে প্রতিটা ক্যাটাগরি পেজ ওই ক্যাটাগরির সব লিস্টিং (select *) একবারে আনত।
// এখন প্রতি পেজে শুধু PAGE_SIZE টা, আর শুধু কার্ডে যা লাগে সেই কলাম।
//
// সাজানো: ইউজারের উপজেলা (cookie 'sf_upazila', locationSort.js সেট করে) আগে,
// তারপর বাকিগুলো; প্রতিটা গ্রুপে নতুন পোস্ট আগে। আগের ক্লায়েন্ট-সাইড
// reorderByUserLocation(..., 'latest')-এর হুবহু সার্ভার ভার্সন, তবে পুরো লিস্ট জুড়ে।
//
// ব্যবহার (পেজের frontmatter-এ):
//   const pg = readListingParams(Astro);
//   const result = await fetchListingPage(supabase, { category: 'recycle', columns: '...', ...pg });
//   result = { rows, total, page, pages, size }
//   const counts = await fetchTypeCounts(supabase, 'recycle');  // { all, byType: { mobile: 3, ... } }
// নিচে <Pagination page={result.page} pages={result.pages} /> (src/components/shared/Pagination.astro)
// ============================================================

export const PAGE_SIZE = 20;

// LocationSelector-এর slug ↔ বাংলা নাম (locationSort.js-এর সাথে মিল রেখে)
const UPAZILA_SLUG_TO_NAME = {
  'feni-sadar': 'ফেনী সদর',
  'chhagalnaiya': 'ছাগলনাইয়া',
  'daganbhuiyan': 'দাগনভূঞা',
  'parshuram': 'পরশুরাম',
  'fulgazi': 'ফুলগাজী',
  'sonagazi': 'সোনাগাজী',
};

function toInt(v, fallback) {
  const n = parseInt(String(v || ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// PostgREST-এর or()/ilike ফিল্টারে ঝামেলা করে এমন চিহ্ন বাদ, দৈর্ঘ্য সীমিত
export function cleanSearch(q) {
  return String(q || '')
    .replace(/[,()*%\\:"'.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

export function readListingParams(Astro) {
  const sp = Astro.url.searchParams;
  const slug = Astro.cookies?.get('sf_upazila')?.value || '';
  const near = UPAZILA_SLUG_TO_NAME[slug] ? { slug, name: UPAZILA_SLUG_TO_NAME[slug] } : null;
  return {
    page: toInt(sp.get('page'), 1),
    type: (sp.get('type') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 30),
    q: cleanSearch(sp.get('q')),
    near,
  };
}

// ইউজার নিজে লেখা টাইপ (যেমন "সাইকেল", "বই") কোনো পিলে পড়ে না — তাই knownTypes দিলে
// type='other' মানে "জানা টাইপগুলোর বাইরে সব"।
// eq: অতিরিক্ত হুবহু-মিল ফিল্টার, যেমন { upazila: 'ফেনী সদর', union_name: '...' } (খালি মান বাদ)
// searchCols: সার্চ কোন কলামে হবে (ডিফল্ট title, description, upazila)
function baseQuery(supabase, { category, columns, type, q, knownTypes, eq, searchCols }, countOnly = false) {
  let query = supabase
    .from('listings')
    .select(columns, countOnly ? { count: 'exact', head: true } : { count: 'exact' })
    .eq('category', category)
    .eq('status', 'active');
  if (eq) {
    Object.entries(eq).forEach(([k, v]) => {
      if (v) query = query.eq(k, v);
    });
  }
  // একাধিক or() গ্রুপ একসাথে হলে একটা or(and(...))-এ জোড়া (PostgREST-এ দুবার or দেওয়া ঝুঁকিপূর্ণ)
  const groups = [];
  if (type === 'other' && knownTypes && knownTypes.length) {
    const known = knownTypes.filter((k) => k !== 'other');
    groups.push(`type.is.null,type.not.in.(${known.join(',')})`);
  } else if (type && type !== 'all') {
    query = query.eq('type', type);
  }
  if (q) {
    const cols = searchCols && searchCols.length ? searchCols : ['title', 'description', 'upazila'];
    groups.push(cols.map((c) => `${c}.ilike."%${q}%"`).join(','));
  }
  if (groups.length === 1) query = query.or(groups[0]);
  else if (groups.length > 1) query = query.or(`and(${groups.map((g) => `or(${g})`).join(',')})`);
  return query;
}

export async function fetchListingPage(supabase, opts) {
  const size = opts.size || PAGE_SIZE;
  const columns = opts.columns || 'id,title,type,price,upazila,images,created_at';
  const o = { ...opts, columns };
  let page = opts.page || 1;

  // উপজেলা জানা না থাকলে: সাধারণ নতুন-আগে কোয়েরি
  if (!opts.near) {
    const from = (page - 1) * size;
    const { data, count, error } = await baseQuery(supabase, o)
      .order('created_at', { ascending: false })
      .range(from, from + size - 1);
    const total = error ? 0 : count || 0;
    const pages = Math.max(1, Math.ceil(total / size));
    if (page > pages && total > 0) return fetchListingPage(supabase, { ...opts, page: pages });
    return { rows: data || [], total, page, pages, size, error };
  }

  // উপজেলা জানা থাকলে: নিজের উপজেলা আগে, তারপর বাকি (দুটো গ্রুপ জোড়া লাগিয়ে পেজ ভাগ)
  const nearValues = [opts.near.name, opts.near.slug];
  const inList = `(${nearValues.map((v) => `"${v}"`).join(',')})`;

  const [{ count: nearTotal }, { count: restTotal }] = await Promise.all([
    baseQuery(supabase, o, true).in('upazila', nearValues),
    baseQuery(supabase, o, true).not('upazila', 'in', inList),
  ]);
  const nT = nearTotal || 0;
  const total = nT + (restTotal || 0);
  const pages = Math.max(1, Math.ceil(total / size));
  if (page > pages) page = pages;

  const from = (page - 1) * size;
  const to = from + size - 1;
  let rows = [];
  let error = null;

  if (from < nT) {
    const r = await baseQuery(supabase, o)
      .in('upazila', nearValues)
      .order('created_at', { ascending: false })
      .range(from, Math.min(to, nT - 1));
    rows = r.data || [];
    error = r.error;
  }
  const need = size - rows.length;
  if (need > 0 && to >= nT) {
    const restFrom = Math.max(0, from - nT);
    const r = await baseQuery(supabase, o)
      .not('upazila', 'in', inList)
      .order('created_at', { ascending: false })
      .range(restFrom, restFrom + need - 1);
    rows = rows.concat(r.data || []);
    error = error || r.error;
  }
  return { rows, total, page, pages, size, error };
}

// ফিল্টার-পিলের সংখ্যা: শুধু type কলাম আনে (হালকা), সার্চ ছাড়া পুরো ক্যাটাগরির হিসাব
export async function fetchTypeCounts(supabase, category, knownTypes = null) {
  const { data } = await supabase
    .from('listings')
    .select('type')
    .eq('category', category)
    .eq('status', 'active');
  const byType = {};
  (data || []).forEach((r) => {
    let t = r.type || 'other';
    if (knownTypes && !knownTypes.includes(t)) t = 'other';
    byType[t] = (byType[t] || 0) + 1;
  });
  return { all: (data || []).length, byType };
}
