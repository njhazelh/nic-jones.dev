// Browser checks against a running preview server (CI only; see .github/workflows/checks.yml).
//   1. axe-core WCAG 2.1 AA scan of every page, light and dark, once the
//      critters have started (so their switch is scanned). Fails on any
//      violation, and on any console error or uncaught exception.
//   2. The critters (src/lib/critters) stay decoration: with JavaScript off a
//      page is unchanged, no text ever sits under one of their canvases, they
//      keep still under reduced motion and they never print.
//   3. With --pdf, prints /resume/ to dist/resume.pdf.
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
const fail = (msg) => (failures++, console.error(msg));
const watch = (page, label) => {
  page.on('console', (m) => m.type() === 'error' && fail(`${label}: console error: ${m.text()}`));
  page.on('pageerror', (e) => fail(`${label}: ${e.message}`));
};
const started = (page) => page.waitForFunction(() => document.documentElement.dataset.critters, null, { timeout: 8000 }).catch(() => fail(`critters never started on ${page.url()}`));

for (const colorScheme of ['light', 'dark']) {
  const page = await browser.newPage({ colorScheme });
  watch(page, colorScheme);
  for (const path of PAGES) {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await started(page);
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

// Text-node rects that overlap any critter canvas (there should be none)
const textUnderCritters = (page) =>
  page.evaluate(() => {
    const canvases = [...document.querySelectorAll('canvas.critters')].map((c) => c.getBoundingClientRect());
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const hits = [];
    for (let n; (n = walker.nextNode()); ) {
      if (!n.textContent.trim() || n.parentElement.closest('script, style, .critter-tag')) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects())
        for (const c of canvases)
          if (r.width && r.height && r.right > c.left && r.left < c.right && r.bottom > c.top && r.top < c.bottom) hits.push(n.textContent.trim().slice(0, 40));
    }
    return hits;
  });

for (const path of ['/', '/colophon/']) {
  // JavaScript off: no trace of the critters, and the same words on the page
  const off = await browser.newPage({ javaScriptEnabled: false });
  await off.goto(BASE + path, { waitUntil: 'networkidle' });
  const offText = await off.evaluate(() => document.getElementById('main').innerText);
  if (await off.locator('canvas').count()) fail(`${path}: a canvas exists with JavaScript off`);
  if ((await off.evaluate(() => getComputedStyle(document.querySelector('.critters-toggle')).display)) !== 'none') fail(`${path}: the Critters switch shows with JavaScript off`);
  await off.close();

  for (const [width, height] of [[1280, 720], [1440, 900], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width, height } });
    watch(page, `${width}px ${path}`);
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await started(page);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    if ((await page.evaluate(() => document.getElementById('main').innerText)) !== offText) fail(`${width}px ${path}: page text differs with JavaScript on`);
    const hits = await textUnderCritters(page);
    if (hits.length) fail(`${width}px ${path}: text under a critter canvas: ${hits.slice(0, 3).join(' | ')}`);
    await page.emulateMedia({ media: 'print' });
    if (!(await page.evaluate(() => [...document.querySelectorAll('canvas.critters, .critter-tag')].every((el) => getComputedStyle(el).display === 'none')))) fail(`${width}px ${path}: critters would print`);
    await page.close();
  }
  console.log(`${path}: critters checked with JavaScript off, at three widths and in print`);
}

{
  // Reduced motion: a still picture
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  watch(page, 'reduced motion');
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await started(page);
  const snap = () => page.evaluate(() => [...document.querySelectorAll('canvas.critters')].map((c) => c.toDataURL()).join());
  const before = await snap();
  await page.waitForTimeout(1000);
  if ((await page.evaluate(() => document.documentElement.dataset.critters)) !== 'still' || (await snap()) !== before) fail('reduced motion: the critters moved');
  else console.log('reduced motion: still');
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
