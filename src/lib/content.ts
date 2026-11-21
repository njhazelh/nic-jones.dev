// What is public, decided once: everything that isn't a draft. Pushing to
// master deploys the site, so removing `draft: true` and pushing publishes.
//
// `npm run dev` shows drafts too, with a banner, so a draft can be read in
// place before it ships.
import { getCollection, type CollectionEntry } from 'astro:content';

export const SHOW_UNPUBLISHED = import.meta.env.DEV;

export type Post = CollectionEntry<'writing'>;
export type Project = CollectionEntry<'projects'>;

/** "Draft" if the entry is held out of production, else null. */
export const hiddenBecause = (e: Post | Project) => (e.data.draft ? 'Draft' : null);
const visible = (e: Post | Project) => SHOW_UNPUBLISHED || !e.data.draft;

const STATUS_ORDER = { active: 0, shipped: 1, paused: 2, retired: 3 } as const;
export const STATUS_LABEL = { active: 'Building', shipped: 'Shipped', paused: 'Paused', retired: 'Retired' } as const;

export async function posts() {
  return (await getCollection('writing', visible)).sort((a, b) => b.data.date.valueOf() - a.data.date.valueOf());
}

/** Active work first, then shipped, paused and retired; newest first within each. */
export async function projects() {
  return (await getCollection('projects', visible)).sort(
    (a, b) => STATUS_ORDER[a.data.status] - STATUS_ORDER[b.data.status] || b.data.started.localeCompare(a.data.started),
  );
}

/** Every tag in use on a visible post, with its posts. */
export async function tagged() {
  const map = new Map<string, Post[]>();
  for (const p of await posts()) for (const t of p.data.tags) map.set(t, [...(map.get(t) ?? []), p]);
  return map;
}

/** Which nav sections have something in them. Nothing in the nav leads to an empty page. */
export async function liveSections() {
  const [w, p] = await Promise.all([posts(), projects()]);
  return { '/projects/': p.length > 0, '/writing/': w.length > 0 };
}

export const hrefFor = (e: Post | Project) => `/${e.collection}/${e.id}/`;

/** "14 March 2027". Dates are written by hand in frontmatter as UTC days. */
export function formatDate(d: Date) {
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export const FORMAT_LABEL = { essay: 'Essay', note: 'Note', link: 'Link' } as const;
