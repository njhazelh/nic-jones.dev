// Typed schemas for every content type. A missing or misspelt field fails the
// build instead of shipping a broken page.
//
// A file's name is its URL: src/content/writing/on-call.md is /writing/on-call/.
// URLs never change, so never rename a published file.
import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/** Fields every dated entry shares. */
const dated = {
  title: z.string(),
  /** One sentence. Used for the index, the meta description and RSS. */
  description: z.string(),
  /** Publish date. A future date is held back until a build on or after it. */
  date: z.coerce.date(),
  /** Set when the substance changes, not for typo fixes. */
  updated: z.coerce.date().optional(),
  /** Drafts never reach the production build. They show in `npm run dev`. */
  draft: z.boolean().default(false),
  /** Pinned entries are linked from the home page. Two at most per collection. */
  pinned: z.boolean().default(false),
  /** Position tags. One tag per position, so each tag page collects a position's evidence. */
  tags: z.array(z.string().regex(/^[a-z0-9-]+$/, 'tags are lower-case-with-hyphens')).default([]),
};

/** Case studies, written as postmortems. */
const work = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/work' }),
  schema: z.object({
    ...dated,
    /** The proof-point word this case study backs: Fast, Stable, Operable or Automated. */
    claim: z.enum(['Fast', 'Stable', 'Operable', 'Automated']).optional(),
    /** One number that is yours to publish, e.g. "40%", shown large. Never an internal employer metric. */
    figure: z.string().optional(),
    /** What the number measures, e.g. "less JavaScript shipped". Required with `figure`. */
    figureLabel: z.string().optional(),
    /** The "what others did" line: teammates credited by role. Leave out for solo work. */
    credits: z.string().optional(),
    supersededBy: reference('work').optional(),
  }).refine((d) => !d.figure || d.figureLabel, { message: '`figure` needs a `figureLabel`', path: ['figureLabel'] }),
});

/** Essays, notes and links. */
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z
    .object({
      ...dated,
      format: z.enum(['essay', 'note', 'link']),
      /** For a link post: the one source it responds to. */
      link: z.url().optional(),
      supersededBy: reference('writing').optional(),
    })
    .refine((d) => d.format !== 'link' || d.link, { message: 'a link post needs `link`', path: ['link'] }),
});

/** The 3 to 5 theses the site argues. */
const positions = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/positions' }),
  schema: z.object({
    /** One sentence a reasonable engineer could disagree with. */
    thesis: z.string(),
    /** The tag that collects this position's essays, notes and case studies. */
    tag: z.string().regex(/^[a-z0-9-]+$/),
    /** Order on the Positions page. */
    order: z.number().int(),
    /** The flagship essay that argues it. */
    essay: reference('writing').optional(),
    updated: z.coerce.date().optional(),
    draft: z.boolean().default(false),
    /** A position you've changed your mind on stays up, pointing at the newer one. */
    supersededBy: reference('positions').optional(),
  }),
});

export const collections = { work, writing, positions };
