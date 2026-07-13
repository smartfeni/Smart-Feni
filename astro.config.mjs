import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel/serverless';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  site: 'https://smart-feni-murex.vercel.app',
  trailingSlash: 'ignore',
});