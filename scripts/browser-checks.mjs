// Browser checks against a running preview server (CI only; see .github/workflows/checks.yml).
//   1. axe-core WCAG 2.1 AA scan of every page, light and dark. Fails on any violation.
//   2. With --pdf, prints /resume/ to dist/resume.pdf.
// Needs `playwright` and `axe-core`, installed in CI with --no-save so they
// don't count against the site's dependency budget.
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const BASE = process.env.BASE_URL ?? 'http://localhost:4321';
// Every page in the sitemap, so new posts and case studies are checked too.
const sitemap = await readFile('dist/sitemap-0.xml', 'utf8');
const PAGES = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname).concat('/404.html');
const require = createRequire(import.meta.url);
const axeSource = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');

const browser = await chromium.launch();
let failures = 0;

for (const colorScheme of ['light', 'dark']) {
  const page = await browser.newPage({ colorScheme });
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(() =>
      // eslint-disable-next-line no-undef
      axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
    );
    for (const v of result.violations) {
      failures++;
      console.error(`${colorScheme} ${path}: ${v.id} (${v.impact}) ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.error(`    ${n.target.join(' ')}`);
    }
    console.log(`${colorScheme} ${path}: ${result.violations.length} violation(s)`);
  }
  await page.close();
}

if (process.argv.includes('--pdf')) {
  const page = await browser.newPage();
  await page.goto(BASE + '/resume/', { waitUntil: 'networkidle' });
  await page.pdf({ path: 'dist/resume.pdf', format: 'A4', margin: { top: '18mm', bottom: '18mm', left: '18mm', right: '18mm' } });
  console.log('wrote dist/resume.pdf');
}

await browser.close();
process.exit(failures ? 1 : 0);
