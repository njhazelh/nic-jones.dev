// Source checks that keep the site from going stale.
//   Errors:   copy pinned to a moment ("currently", "recently", "this year"),
//             cadence promises ("weekly", "latest post").
//             a TODO left in a content entry that isn't a draft (it would ship),
//             a metric next to a former employer's name without a public
//             source on the same line (Meta work stays at resume level).
//   Warnings: unconfirmed TODO values in the data file and in drafts, passed
//             reviewBy dates.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const SCAN = ['src/pages', 'src/content', 'src/data'];
const STALE = [
  /\bcurrently\b/i,
  /\brecently\b/i,
  /\bthis (?:year|month|week)\b/i,
  /\bnowadays\b/i,
  /\bweekly\b/i,
  /\blatest (?:post|posts|writing)\b/i,
  /\bnew post every\b/i,
];

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(astro|md|mdx|ts)$/.test(e.name)) yield p;
  }
}

/** Strip code comments and Astro frontmatter so only visible copy is checked. */
function visibleText(src, file) {
  // Blank removed blocks but keep their newlines, so line numbers stay right.
  const blank = (m) => m.replace(/[^\n]/g, '');
  let s = src;
  if (file.endsWith('.astro')) s = s.replace(/^---[\s\S]*?---/, blank);
  s = s.replace(/<style[\s\S]*?<\/style>/g, blank);
  s = s.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/.*$/gm, '$1');
  return s;
}

// Confidentiality: a percentage, multiplier or "halved" near Meta, Instagram,
// Facebook or WhatsApp is probably an internal metric. Allowed only when the
// same line links a public source, such as Meta's own engineering blog.
const EMPLOYER = /\b(?:Meta|Instagram|Facebook|WhatsApp)\b/i;
const METRIC = /\d+(?:\.\d+)?\s*(?:%|×|x\b)|×|½|\b(?:halved|doubled|tripled|quadrupled|tenfold|in half)\b/i;
const SOURCE = /https?:\/\//;

const errors = [];
const warnings = [];

for (const dir of SCAN) {
  for await (const file of walk(join(ROOT, dir))) {
    const src = await readFile(file, 'utf8');
    const rel = relative(ROOT, file);
    const text = visibleText(src, file);
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const re of STALE) {
        const m = line.match(re);
        if (m) errors.push(`${rel}:${i + 1} stale or cadence wording "${m[0]}"`);
      }
    });
    const isEntry = rel.startsWith('src/content/') && rel.endsWith('.md');
    const frontmatter = src.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? '';
    const isDraft = /^draft:\s*true\b/m.test(frontmatter);
    // Check each line with the next, so a sentence wrapped across two lines counts.
    lines.forEach((line, i) => {
      const window = `${line} ${lines[i + 1] ?? ''}`;
      if (!EMPLOYER.test(window) || !METRIC.test(window) || SOURCE.test(window)) return;
      const msg = `${rel}:${i + 1} possible internal metric "${window.match(METRIC)[0]}" near "${window.match(EMPLOYER)[0]}"; keep it at resume level or link a public source on the line`;
      if (isEntry && isDraft) warnings.push(msg);
      else errors.push(msg);
    });
    src.split('\n').forEach((line, i) => {
      if (!/TODO/.test(line)) return;
      if (isEntry && !isDraft) errors.push(`${rel}:${i + 1} TODO in an entry that will publish; finish it or set draft: true`);
      else if (/TODO:/.test(line)) warnings.push(`${rel}:${i + 1} ${line.trim()}`);
    });
  }
}

const { profile } = await import(join(ROOT, 'src/data/profile.ts')).catch(() => ({ profile: null }));
if (profile) {
  const today = new Date().toISOString().slice(0, 10);
  for (const [page, date] of Object.entries(profile.reviewBy)) {
    if (date < today) warnings.push(`review overdue: ${page} (reviewBy ${date})`);
  }
}

for (const w of warnings) console.warn(`warn  ${w}`);
for (const e of errors) console.error(`error ${e}`);
console.log(`check-prose: ${errors.length} error(s), ${warnings.length} warning(s)`);
process.exit(errors.length ? 1 : 0);
