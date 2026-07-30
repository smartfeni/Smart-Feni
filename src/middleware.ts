// src/middleware.ts
import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(async (context, next) => {
  const hostname = context.request.headers.get('host') || '';

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