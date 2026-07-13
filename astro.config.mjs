import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import llmsTxt from '@waldheimdev/astro-ai-llms-txt';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  site: 'https://smart-feni-murex.vercel.app',
  trailingSlash: 'ignore',
  integrations: [
    llmsTxt({
      include: ['/**'],
      exclude: ['/api/**'],
    })
  ]
});