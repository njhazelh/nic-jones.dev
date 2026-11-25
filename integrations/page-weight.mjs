// Replaces <!--page-weight--> in every built page with real measurements:
// gzipped bytes of the page and everything it loads, the request count, how
// much of that is JavaScript, and the build time, as the footer's readout. The footer can't drift from the
// truth because it is the truth.
import { readFile, writeFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MARK = '<!--page-weight-->';
const COMPRESSED = /\.(woff2|png|jpe?g|webp|avif|gif)$/i;

async function transferBytes(file) {
  const buf = await readFile(file);
  return COMPRESSED.test(file) ? buf.length : gzipSync(buf, { level: 9 }).length;
}

/** Local subresources a page will fetch on first load. */
function subresources(html) {
  const urls = new Set();
  for (const m of html.matchAll(/<link[^>]+rel="(?:stylesheet|preload|icon)"[^>]*>/g)) {
    const href = m[0].match(/href="([^"]+)"/)?.[1];
    if (href?.startsWith('/')) urls.add(href);
  }
  // <picture>: a browser fetches one candidate from the first <source> it
  // supports (AVIF here). Count the largest, the worst case on a dense screen,
  // and skip the fallback <img>.
  for (const pic of html.matchAll(/<picture[\s\S]*?<\/picture>/g)) {
    const srcset = pic[0].match(/<source[^>]+srcset="([^"]+)"/)?.[1];
    const largest = srcset
      ?.split(',')
      .map((c) => c.trim().split(/\s+/))
      .sort((a, b) => parseFloat(b[1] ?? '1') - parseFloat(a[1] ?? '1'))[0]?.[0];
    if (largest?.startsWith('/')) urls.add(largest);
  }
  const outsidePictures = html.replace(/<picture[\s\S]*?<\/picture>/g, '');
  for (const m of outsidePictures.matchAll(/<(?:script|img)[^>]+src="(\/[^"]+)"/g)) urls.add(m[1]);
  // A declared @font-face is only fetched if the page renders text in it, so
  // count a face only when the page uses its style and weight.
  const body = html.replace(/@font-face\s*\{[^}]*\}/g, '');
  const usesItalic = /<(?:em|i|cite|dfn|var)[\s>]|font-style:\s*italic/i.test(body);
  const usesBold = /<(?:h[1-6]|strong|b|th|dt)[\s>]|font-weight:\s*(?:[6-9]00|bold)/i.test(body);
  for (const m of html.matchAll(/@font-face\s*\{([^}]*)\}/g)) {
    const face = m[1];
    const url = face.match(/url\(['"]?(\/[^'")]+)['"]?\)/)?.[1];
    if (!url) continue;
    const italic = /font-style:\s*italic/.test(face);
    const weight = Number(face.match(/font-weight:\s*(\d+)/)?.[1] ?? 400);
    if (italic && !usesItalic) continue;
    if (weight >= 600 && !usesBold) continue;
    urls.add(url);
  }
  return [...urls];
}

/** Gzipped bytes of every script the page runs: module files and inline code (JSON-LD is data, not code). */
async function scriptBytes(html, root) {
  let bytes = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const [, attrs, body] = m;
    if (/type="application\/ld\+json"/.test(attrs)) continue;
    const src = attrs.match(/src="(\/[^"]+)"/)?.[1];
    if (src) bytes += await transferBytes(join(root, src));
    else if (body.trim()) bytes += gzipSync(Buffer.from(body), { level: 9 }).length;
  }
  return bytes;
}

export default function pageWeight() {
  let started = 0;
  return {
    name: 'page-weight',
    hooks: {
      'astro:build:start': () => {
        started = performance.now();
      },
      'astro:build:done': async ({ dir, pages, logger }) => {
        const root = fileURLToPath(dir);
        const seconds = ((performance.now() - started) / 1000).toFixed(1);
        const report = [];
        for (const { pathname } of pages) {
          const candidates = [join(root, pathname, 'index.html'), join(root, `${pathname.replace(/\/$/, '')}.html`)];
          let file;
          for (const c of candidates) {
            if (await stat(c).then(() => true, () => false)) {
              file = c;
              break;
            }
          }
          if (!file) continue;
          const html = await readFile(file, 'utf8');
          if (!html.includes(MARK)) continue;
          const subs = subresources(html);
          let bytes = gzipSync(Buffer.from(html), { level: 9 }).length;
          for (const url of subs) bytes += await transferBytes(join(root, url));
          const kb = (bytes / 1024).toFixed(1);
          const requests = subs.length + 1;
          const js = await scriptBytes(html, root);
          const jsKb = (js / 1024).toFixed(1);
          const readout = [
            ['This page', `${kb} KB`],
            ['Requests', String(requests)],
            ['JavaScript', js ? `${jsKb} KB` : 'None'],
            ['Built in', `${seconds} s`],
          ]
            .map(([term, value]) => `<div><dt>${term}</dt><dd>${value}</dd></div>`)
            .join('');
          await writeFile(file, html.replace(MARK, `<dl class="readout" data-page-kb="${kb}" data-page-js-kb="${jsKb}">${readout}</dl>`));
          report.push(`/${pathname} ${kb} KB, ${requests} req, ${jsKb} KB JS`);
        }
        logger.info(report.join('\n'));
      },
    },
  };
}
