// Lists content entries that are due but not yet on the live site, so the
// publish workflow rebuilds only when a build would add something.
//
// It compares against the live sitemap rather than a time window, so a late
// or skipped scheduled run, or a failed deploy, is caught up by the next one.
//
// "Due" uses the same rule as src/lib/content.ts: not a draft, and the date
// has passed. Dates are parsed the way the build parses them, so quoted and
// unquoted values, date-only and date-time forms all agree:
//   2026-12-15, "2026-12-15", 2026-12-15T09:00:00Z, '2026-12-15T09:00Z'
// A date-only value is midnight UTC.
//
// Usage: node scripts/due.mjs [--live https://nick-jones.me] [--now ISO]
// Prints one path per entry that is due and missing; prints nothing if none.
// If the live sitemap can't be read, every due entry counts as missing, so
// the workflow rebuilds rather than skipping.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const now = new Date(arg('now', new Date().toISOString()));
const live = arg('live', 'https://nick-jones.me');

/** Every page path in the live sitemap, or null if it can't be read. */
async function livePaths() {
  try {
    const get = async (url) => {
      const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(`${url}: ${res.status}`);
      return res.text();
    };
    const locs = (xml) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    const paths = new Set();
    // The index lists absolute URLs on the configured site; read them from `live`.
    for (const sitemap of locs(await get(new URL('/sitemap-index.xml', live)))) {
      for (const page of locs(await get(new URL(new URL(sitemap).pathname, live)))) paths.add(new URL(page).pathname);
    }
    return paths;
  } catch (err) {
    console.error(`could not read the live sitemap (${err.message}); treating every due entry as missing`);
    return null;
  }
}
const published = await livePaths();

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith('.md')) yield p;
  }
}

/** A top-level frontmatter scalar, without quotes or a trailing comment. */
function field(frontmatter, key) {
  const line = frontmatter.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'))?.[1];
  if (line === undefined) return undefined;
  const quoted = line.match(/^(['"])(.*?)\1/);
  return quoted ? quoted[2] : line.replace(/\s+#.*$/, '').trim();
}

/** YAML timestamps without a zone are UTC; so are date-only values. */
function parseDate(value) {
  if (!value) return null;
  const v = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value.replace(' ', 'T')}Z` : value;
  const d = new Date(v);
  return Number.isNaN(d.valueOf()) ? null : d;
}

const CONTENT = join(ROOT, 'src/content');
for await (const file of walk(CONTENT)) {
  const src = await readFile(file, 'utf8');
  const frontmatter = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!frontmatter || field(frontmatter, 'draft') === 'true') continue;
  const date = parseDate(field(frontmatter, 'date'));
  if (!date || date > now) continue;
  // src/content/<collection>/<id>.md is served at /<collection>/<id>/.
  const path = `/${relative(CONTENT, file).replace(/\.md$/, '').toLowerCase()}/`;
  if (!published?.has(path)) console.log(relative(ROOT, file));
}
