// Open Graph cards: the image a link preview shows when a page is shared.
// One card per page, drawn at build time from the page's own title and
// description, in the site's type and colours.
//
// Base.astro points every page at /og/<path>.png. scripts/check-dist.mjs
// fails the build if a page names a card that wasn't generated, so a new page
// needs an entry here.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import satori from 'satori';
import sharp from 'sharp';
import { profile } from '../data/profile';
import { projects, posts, tagged, FORMAT_LABEL, STATUS_LABEL } from './content';
import { frames, BUDGET, share } from './frames';

export interface Card {
  /** Page path without slashes, e.g. "projects/loadmatter"; "index" for home. */
  path: string;
  kicker: string;
  title: string;
  description: string;
}

/** The card path for a page URL: "/" -> "index", "/projects/x/" -> "projects/x". */
export const cardPath = (pathname: string) => pathname.replace(/^\/|\/$/g, '').replace(/\.html$/, '') || 'index';

export async function cards(): Promise<Card[]> {
  const [allProjects, allPosts, tags] = await Promise.all([projects(), posts(), tagged()]);
  const list: Card[] = [
    { path: 'index', kicker: profile.role, title: profile.pitch, description: '' },
    { path: 'about', kicker: 'About', title: profile.name, description: profile.role },
    { path: 'resume', kicker: 'Resume', title: profile.fullName, description: profile.role },
    { path: 'contact', kicker: 'Contact', title: `How to reach ${profile.name}`, description: '' },
    {
      path: 'colophon',
      kicker: 'Colophon',
      title: 'How this site is built',
      description: 'The budgets it holds and the options I turned down.',
    },
    { path: '404', kicker: 'Not found', title: 'Nothing here', description: '' },
  ];
  if (allProjects.length) {
    list.push({ path: 'projects', kicker: 'Projects', title: "What I'm building", description: '' });
  }
  for (const p of allProjects) {
    list.push({
      path: `projects/${p.id}`,
      kicker: `Project · ${STATUS_LABEL[p.data.status]}`,
      title: p.data.title,
      description: p.data.description,
    });
  }
  if (allPosts.length) {
    list.push({ path: 'writing', kicker: 'Writing', title: `Writing by ${profile.name}`, description: '' });
  }
  for (const p of allPosts) {
    list.push({ path: `writing/${p.id}`, kicker: FORMAT_LABEL[p.data.format], title: p.data.title, description: p.data.description });
  }
  for (const tag of tags.keys()) {
    const name = tag.replaceAll('-', ' ');
    list.push({ path: `tags/${tag}`, kicker: 'Topic', title: name[0].toUpperCase() + name.slice(1), description: '' });
  }
  return list;
}

// Colours from src/styles/tokens.css (light theme).
const PLASTER = '#f4efe6';
const SLATE = '#2a3439';
const SLATE_SOFT = '#55626a';
const BRICK = '#9b3a24';
const RULE = '#c9c4bb';

let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600; style: 'normal' }[]> | undefined;
const loadFonts = () =>
  (fonts ??= Promise.all(
    ([400, 600] as const).map(async (weight) => ({
      name: 'Source Serif 4',
      // Resolved from the project root: this module runs from a bundled copy at build.
      data: await readFile(join(process.cwd(), `src/assets/og/source-serif-4-latin-${weight}-normal.woff`)),
      weight,
      style: 'normal' as const,
    })),
  ));

/** A plain element tree, the shape satori takes without React. */
const el = (type: string, style: Record<string, unknown>, children?: unknown) => ({ type, props: { style, children } });

/** Long titles step down in size so they fit in three lines. */
const titleSize = (t: string) => (t.length > 90 ? 56 : t.length > 50 ? 66 : 76);

export async function renderCard(card: Card): Promise<Buffer> {
  const top = el('div', { display: 'flex', flexDirection: 'column' }, [
    el('div', { fontSize: 30, color: BRICK, letterSpacing: 1 }, card.kicker),
    el('div', { marginTop: 24, fontSize: titleSize(card.title), fontWeight: 600, lineHeight: 1.12, lineClamp: 3 }, card.title),
    card.description
      ? el('div', { marginTop: 28, fontSize: 34, lineHeight: 1.35, color: SLATE_SOFT, lineClamp: 2 }, card.description)
      : el('div', {}, ''),
  ]);
  // The home page's frame-time chart, small, between the name and the address
  const CHART_H = 44;
  const chart = el(
    'div',
    { display: 'flex', alignItems: 'flex-end', gap: 3, height: CHART_H },
    frames.map((ms) =>
      el('div', { width: 4, height: Math.max(2, Math.round(share(ms) * CHART_H)), background: ms > BUDGET ? BRICK : RULE }),
    ),
  );
  const footer = el(
    'div',
    {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
      paddingTop: 24,
      borderTop: `2px solid ${RULE}`,
      fontSize: 28,
      color: SLATE_SOFT,
    },
    [el('div', { fontWeight: 600, color: SLATE }, profile.name), chart, el('div', {}, new URL(profile.site).host)],
  );
  // Padding goes on an inner box: on the fixed-size root, satori adds it to
  // the height and pushes the footer off the card.
  const tree = el(
    'div',
    { width: 1200, height: 630, display: 'flex', background: PLASTER, borderLeft: `16px solid ${BRICK}`, fontFamily: 'Source Serif 4', color: SLATE },
    [el('div', { display: 'flex', flexDirection: 'column', justifyContent: 'space-between', flexGrow: 1, padding: '72px 88px' }, [top, footer])],
  );
  const svg = await satori(tree as never, { width: 1200, height: 630, fonts: await loadFonts() });
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer();
}
