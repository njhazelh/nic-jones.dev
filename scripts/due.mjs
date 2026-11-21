// Lists content entries that came due since the last scheduled build, so the
// publish workflow rebuilds only when something new would appear.
//
// "Due" uses the same rule as src/lib/content.ts: not a draft, and the date
// has passed. Dates are parsed the way the build parses them, so quoted and
// unquoted values, date-only and date-time forms all agree:
//   2026-12-15, "2026-12-15", 2026-12-15T09:00:00Z, '2026-12-15T09:00Z'
// A date-only value is midnight UTC.
//
// Usage: node scripts/due.mjs [--hours 24] [--now ISO]
// Prints one path per due entry; prints nothing if none.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const now = new Date(arg('now', new Date().toISOString()));
const since = new Date(now.valueOf() - Number(arg('hours', '24')) * 3600_000);

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

for await (const file of walk(join(ROOT, 'src/content'))) {
  const src = await readFile(file, 'utf8');
  const frontmatter = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1];
  if (!frontmatter || field(frontmatter, 'draft') === 'true') continue;
  const date = parseDate(field(frontmatter, 'date'));
  if (date && date > since && date <= now) console.log(relative(ROOT, file));
}
