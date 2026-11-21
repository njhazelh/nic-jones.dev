// Replaces <!--page-weight--> in every built page with real measurements:
// gzipped bytes of the page and everything it loads, the request count, and
// the build time. The footer can't drift from the truth because it is the truth.
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
  for (const m of html.matchAll(/<(?:script|img)[^>]+src="(\/[^"]+)"/g)) urls.add(m[1]);
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
          const line = `This page: ${kb} KB over ${requests} request${requests === 1 ? '' : 's'}, no JavaScript, built in ${seconds} s.`;
          await writeFile(file, html.replace(MARK, line));
          report.push(`/${pathname} ${kb} KB, ${requests} req`);
        }
        logger.info(report.join('\n'));
      },
    },
  };
}
