// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';

const VERCEL_DEFAULT_DOMAIN = 'smart-feni-murex.vercel.app';
const CANONICAL_DOMAIN = 'smartfeni.com';

export const onRequest = defineMiddleware(async (context, next) => {
  const hostname = context.request.headers.get('host') || '';

  // পুরনো vercel.app ডোমেইন থেকে smartfeni.com এ permanent redirect (SEO ডুপ্লিকেট কন্টেন্ট এড়াতে)
  if (hostname === VERCEL_DEFAULT_DOMAIN || hostname === `club.${VERCEL_DEFAULT_DOMAIN}`) {
    const url = new URL(context.request.url);
    const newHostname =
      hostname === VERCEL_DEFAULT_DOMAIN ? CANONICAL_DOMAIN : `club.${CANONICAL_DOMAIN}`;
    const redirectUrl = new URL(url.pathname + url.search, `https://${newHostname}`);
    return context.redirect(redirectUrl.toString(), 301);
  }

  // club.smartfeni.com (বা club.localhost:xxxx, club.xxx.vercel.app) থেকে আসা রিকোয়েস্ট ধরা
  const isClubSubdomain = hostname.startsWith('club.');

  if (isClubSubdomain) {
    const url = new URL(context.request.url);

    // রুট পাথ ("/") হলে /clubs পেজে rewrite
    if (url.pathname === '/' || url.pathname === '') {
      return context.rewrite(new URL('/clubs', context.url));
    }
  }

  return next();
});