// Browser checks against a running preview server (CI only; see .github/workflows/checks.yml).
//   1. axe-core WCAG 2.1 AA scan of every page, light and dark, once the
//      critters have started (so their switch is scanned). Fails on any
//      violation, and on any console error or uncaught exception.
//   2. The critters (src/lib/critters) stay decoration: with JavaScript off a
//      page is unchanged, no word sits under a critter at rest (the tiger
//      stands on the text, never in front of it), they keep still under
//      reduced motion and they never print.
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

// Words with a drawn critter pixel over them (there should be none). A word
// is measured from the top of its tallest letters to the bottom of its
// descenders, which is the space the tiger keeps clear when it stands on a line.
const wordsUnderCritters = (page) =>
  page.evaluate(() => {
    const pen = document.createElement('canvas').getContext('2d');
    const words = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode()); ) {
      const el = n.parentElement;
      if (!n.textContent.trim() || el.closest('script, style, .critter-tag, .visually-hidden')) continue;
      const cs = getComputedStyle(el);
      pen.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const tall = pen.measureText('Hd');
      const low = pen.measureText('gjpy').actualBoundingBoxDescent;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) {
        const base = r.top + tall.fontBoundingBoxAscent;
        if (r.width > 1) words.push([r.left, base - tall.actualBoundingBoxAscent, r.right, base + low, n.textContent.trim().slice(0, 40)]);
      }
    }
    const hits = new Set();
    for (const c of document.querySelectorAll('canvas.critters')) {
      const r = c.getBoundingClientRect();
      const kx = r.width / c.width;
      const ky = r.height / c.height;
      const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      for (let y = 0; y < c.height; y++)
        for (let x = 0; x < c.width; x++) {
          if (data[(y * c.width + x) * 4 + 3] < 128) continue;
          const px = r.left + (x + 0.5) * kx;
          const py = r.top + (y + 0.5) * ky;
          for (const w of words) if (px > w[0] && px < w[2] && py > w[1] && py < w[3]) hits.add(w[4]);
        }
    }
    return [...hits];
  });

for (const path of PAGES) {
  // JavaScript off: no trace of the critters, and the same words on the page
  const off = await browser.newPage({ javaScriptEnabled: false });
  await off.goto(BASE + path, { waitUntil: 'networkidle' });
  const offText = await off.evaluate(() => document.getElementById('main').innerText);
  if (await off.locator('canvas').count()) fail(`${path}: a canvas exists with JavaScript off`);
  if ((await off.evaluate(() => getComputedStyle(document.querySelector('.critters-toggle')).display)) !== 'none') fail(`${path}: the Critters switch shows with JavaScript off`);
  await off.close();

  // Under reduced motion every critter is at rest, so where they stand is fixed
  for (const [width, height] of [[1280, 720], [1440, 900], [375, 812]]) {
    const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
    watch(page, `${width}px ${path}`);
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await started(page);
    for (const where of ['top', 'bottom']) {
      if (where === 'bottom') await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(300);
      const hits = await wordsUnderCritters(page);
      if (hits.length) fail(`${width}px ${path} (${where}): words under a critter: ${hits.slice(0, 3).join(' | ')}`);
    }
    if ((await page.evaluate(() => document.getElementById('main').innerText)) !== offText) fail(`${width}px ${path}: page text differs with JavaScript on`);
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
