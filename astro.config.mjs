// astro.config.mjs
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import sentry from '@sentry/astro';

export default defineConfig({
  output: 'static',
  adapter: vercel(),
  integrations: [
    // Sentry (ধাপ ৮): শুধু ব্রাউজার। সার্ভার এরর serverErrorReporter → app_error_logs-এ যায়।
    // Replay/Tracing/সোর্সম্যাপ আপলোড নেই; DSN env: PUBLIC_SENTRY_DSN (sentry.client.config.js)
    sentry({
      enabled: { client: true, server: false },
      sourcemaps: { disable: true },
      telemetry: false,
    }),
  ],
  site: 'https://smartfeni.com',
  trailingSlash: 'ignore',
  security: {
    checkOrigin: false,
  },
});