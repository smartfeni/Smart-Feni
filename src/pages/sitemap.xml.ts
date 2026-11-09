// path: src/pages/sitemap.xml.ts
// ============================================================
// ডাইনামিক sitemap (/sitemap.xml)
// স্ট্যাটিক পেজ + ডাটাবেজ থেকে অটো: ক্লাব, শপ, প্রোডাক্ট, অন্য লিস্টিং, ডাক্তার।
// শুধু পাবলিশড/সক্রিয় আইটেম (পেজগুলোর নিজস্ব ফিল্টারের সাথে মিল রেখে)।
// ১ ঘণ্টা edge cache — প্রতি ক্রলে ডাটাবেজ হিট/egress এড়াতে।
// ============================================================

export const prerender = false;

import type { APIRoute } from 'astro';
import { supabase } from '../lib/supabase.js';

const SITE = 'https://smartfeni.com';
const PAGE_SIZE = 1000;
const MAX_PAGES = 20; // সর্বোচ্চ ২০,০০০ রো প্রতি টেবিল

// [path, changefreq, priority]
const STATIC_PATHS: [string, string, string][] = [
  ['/', 'daily', '1.0'],
  ['/about', 'monthly', '0.5'],
  ['/privacy-policy', 'monthly', '0.3'],
  ['/terms-of-service', 'monthly', '0.3'],
  ['/clubs', 'daily', '0.7'],
  ['/shop', 'daily', '0.7'],
  ['/services/car-rental', 'daily', '0.9'],
  ['/services/doctor-directory', 'daily', '0.9'],
  ['/services/courier', 'daily', '0.8'],
  ['/services/ride', 'daily', '0.8'],
  ['/services/blood', 'daily', '0.8'],
  ['/services/online-shop', 'daily', '0.8'],
  ['/services/tuition', 'daily', '0.8'],
  ['/services/housing', 'daily', '0.8'],
  ['/services/job', 'daily', '0.8'],
  ['/services/repair', 'daily', '0.8'],
  ['/services/recycle', 'daily', '0.7'],
  ['/services/sports', 'daily', '0.7'],
];

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function urlEntry(path: string, opts: { lastmod?: string | null; changefreq?: string; priority?: string } = {}): string {
  const loc = xmlEscape(SITE + encodeURI(path));
  let out = '  <url>\n    <loc>' + loc + '</loc>\n';
  if (opts.lastmod) {
    const d = new Date(opts.lastmod);
    if (!isNaN(d.getTime())) out += '    <lastmod>' + d.toISOString() + '</lastmod>\n';
  }
  if (opts.changefreq) out += '    <changefreq>' + opts.changefreq + '</changefreq>\n';
  if (opts.priority) out += '    <priority>' + opts.priority + '</priority>\n';
  out += '  </url>\n';
  return out;
}

// Supabase একবারে ১০০০ রো দেয় — পেজ করে সব আনে
async function fetchAll(label: string, build: (from: number, to: number) => any): Promise<any[]> {
  const rows: any[] = [];
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await build(i * PAGE_SIZE, i * PAGE_SIZE + PAGE_SIZE - 1);
    if (error) {
      console.error('sitemap ' + label + ' fetch error:', error.message);
      break;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) break;
  }
  return rows;
}

export const GET: APIRoute = async () => {
  const [clubs, shops, products, listings, doctors] = await Promise.all([
    fetchAll('clubs', (from, to) =>
      supabase.from('clubs').select('slug, created_at').eq('is_active', true).order('created_at').order('slug').range(from, to)
    ),
    fetchAll('shops', (from, to) =>
      supabase.from('shops').select('slug, created_at').eq('is_active', true).order('created_at').order('slug').range(from, to)
    ),
    fetchAll('products', (from, to) =>
      supabase
        .from('listings')
        .select('id, created_at')
        .eq('category', 'online-shop')
        .eq('status', 'active')
        .eq('is_disabled', false)
        .order('created_at')
        .order('id')
        .range(from, to)
    ),
    fetchAll('listings', (from, to) =>
      supabase
        .from('listings')
        .select('id, created_at')
        .neq('category', 'online-shop')
        .eq('status', 'active')
        .eq('is_disabled', false)
        .order('created_at')
        .order('id')
        .range(from, to)
    ),
    fetchAll('doctors', (from, to) =>
      supabase.from('doctors').select('id, updated_at').eq('status', 'published').order('created_at').order('id').range(from, to)
    ),
  ]);

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  for (const [path, changefreq, priority] of STATIC_PATHS) {
    xml += urlEntry(path, { changefreq, priority });
  }
  for (const c of clubs) {
    if (c.slug) xml += urlEntry('/' + c.slug, { lastmod: c.created_at, changefreq: 'weekly', priority: '0.6' });
  }
  for (const s of shops) {
    if (s.slug) xml += urlEntry('/' + s.slug, { lastmod: s.created_at, changefreq: 'weekly', priority: '0.7' });
  }
  for (const p of products) {
    xml += urlEntry('/product/' + p.id, { lastmod: p.created_at, changefreq: 'weekly', priority: '0.6' });
  }
  for (const l of listings) {
    xml += urlEntry('/listing/' + l.id, { lastmod: l.created_at, changefreq: 'weekly', priority: '0.6' });
  }
  for (const d of doctors) {
    xml += urlEntry('/doctor/' + d.id, { lastmod: d.updated_at, changefreq: 'weekly', priority: '0.8' });
  }

  xml += '</urlset>\n';

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
};
