// What is public, decided once. An entry is public when it isn't a draft and
// its date has arrived. The daily rebuild (.github/workflows/publish.yml)
// is what makes a future-dated post appear on its day.
//
// `npm run dev` shows everything, drafts and future posts included, with a
// banner, so a draft can be read in place before it ships.
import { getCollection, type CollectionEntry } from 'astro:content';

export const SHOW_UNPUBLISHED = import.meta.env.DEV;

type Dated = CollectionEntry<'work'> | CollectionEntry<'writing'>;

const today = new Date();

/** Why an entry is hidden in production, or null if it is public. */
export function hiddenBecause(entry: Dated | CollectionEntry<'positions'>): string | null {
  if (entry.data.draft) return 'Draft';
  if ('date' in entry.data && entry.data.date > today) {
    return `Scheduled for ${formatDate(entry.data.date)}`;
  }
  return null;
}

const visible = (e: Dated | CollectionEntry<'positions'>) => SHOW_UNPUBLISHED || hiddenBecause(e) === null;
const newestFirst = (a: Dated, b: Dated) => b.data.date.valueOf() - a.data.date.valueOf();

export async function caseStudies() {
  return (await getCollection('work', visible)).sort(newestFirst);
}

export async function posts() {
  return (await getCollection('writing', visible)).sort(newestFirst);
}

export async function positions() {
  return (await getCollection('positions', visible)).sort((a, b) => a.data.order - b.data.order);
}

/** Every tag in use on a visible post or case study, with its entries. */
export async function tagged() {
  const map = new Map<string, Dated[]>();
  for (const e of [...(await caseStudies()), ...(await posts())]) {
    for (const t of e.data.tags) map.set(t, [...(map.get(t) ?? []), e]);
  }
  for (const list of map.values()) list.sort(newestFirst);
  return map;
}

/** Which nav sections have something in them. Nothing in the nav leads to an empty page. */
export async function liveSections() {
  const [w, p, s] = await Promise.all([caseStudies(), posts(), positions()]);
  return { '/work/': w.length > 0, '/writing/': p.length > 0, '/positions/': s.length > 0 };
}

export const hrefFor = (e: Dated) => `/${e.collection}/${e.id}/`;

/** "14 March 2027". Dates are written by hand in frontmatter as UTC days. */
export function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const FORMAT_LABEL = { essay: 'Essay', note: 'Note', link: 'Link', work: 'Case study' } as const;
export const formatOf = (e: Dated) => (e.collection === 'work' ? 'work' : e.data.format);
