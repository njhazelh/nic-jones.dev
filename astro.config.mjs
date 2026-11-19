import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import pageWeight from './integrations/page-weight.mjs';

export default defineConfig({
  site: 'https://nick-jones.me',
  trailingSlash: 'always',
  build: {
    format: 'directory',
    // One request for the page and its styles.
    inlineStylesheets: 'always',
  },
  integrations: [sitemap(), pageWeight()],
});
