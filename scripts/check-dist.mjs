// Checks on the built site (run after `astro build`).
//   - No request leaves the site's own origin: every src/href that the browser
//     fetches automatically must be relative. Plain <a> links may go anywhere.
//   - No phone number in any built page.
//   - Home page under the 100 KB transfer budget (gzip, page + subresources).
//   - No page runs more than 15 KB of JavaScript (gzip), all of it in one
//     module script with no modulepreload, so the footer readout counts it all.
//   - Built JavaScript holds no absolute URL (a fetch to another host).
//   - Every page's link-preview card (og:image) was generated.
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

const DIST = new URL('../dist/', import.meta.url).pathname;
const BUDGET_KB = 100;
const JS_BUDGET_KB = 15;

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const errors = [];
const FETCHED = [
  /<(?:script|img|iframe|source|video|audio)[^>]+src="([^"]+)"/g,
  /<link[^>]+rel="(?:stylesheet|preload|icon|modulepreload|preconnect)"[^>]+href="([^"]+)"/g,
  /url\(['"]?([^'")]+)['"]?\)/g,
];
const PHONE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;

for await (const file of walk(DIST)) {
  const rel = relative(DIST, file);
  if (file.endsWith('.js')) {
    const url = (await readFile(file, 'utf8')).match(/\bhttps?:\/\/[^\s'"`)]+/)?.[0];
    if (url) errors.push(`${rel}: absolute URL ${url} in built JavaScript`);
    continue;
  }
  if (!/\.(html|css|xml|txt)$/.test(file)) continue;
  const text = await readFile(file, 'utf8');
  if (file.endsWith('.html')) {
    const js = Number(text.match(/data-page-js-kb="([\d.]+)"/)?.[1] ?? 0);
    if (js > JS_BUDGET_KB) errors.push(`${rel}: ${js} KB of JavaScript is over the ${JS_BUDGET_KB} KB budget`);
    if (/rel="modulepreload"/.test(text)) errors.push(`${rel}: modulepreload would load JavaScript the readout doesn't count`);
    if ((text.match(/<script[^>]+type="module"/g) ?? []).length > 1) errors.push(`${rel}: more than one module script`);
  }
  for (const re of FETCHED) {
    for (const m of text.matchAll(re)) {
      if (/^(?:https?:)?\/\//.test(m[1])) errors.push(`${rel}: third-party request to ${m[1]}`);
    }
  }
  const og = text.match(/<meta property="og:image" content="https?:\/\/[^/]+(\/og\/[^"]+\.png)"/)?.[1];
  if (file.endsWith('.html') && !og) errors.push(`${rel}: no og:image`);
  if (og && !(await stat(join(DIST, og)).then(() => true, () => false))) errors.push(`${rel}: og:image ${og} was not generated`);
  const phone = text.replace(/<[^>]+>/g, ' ').match(PHONE);
  if (phone) errors.push(`${rel}: looks like a phone number "${phone[0]}"`);
}

// Home page budget, measured the same way as the footer line.
const home = await readFile(join(DIST, 'index.html'), 'utf8');
const kb = Number(home.match(/data-page-kb="([\d.]+)"/)?.[1]);
if (!kb) errors.push('index.html: footer page-weight readout missing');
else if (kb > BUDGET_KB) errors.push(`index.html: ${kb} KB is over the ${BUDGET_KB} KB budget`);

for (const e of errors) console.error(`error ${e}`);
console.log(`check-dist: ${errors.length} error(s); home page ${kb} KB of ${BUDGET_KB} KB`);
process.exit(errors.length ? 1 : 0);
