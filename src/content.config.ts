// Typed schemas for every content type. A missing or misspelt field fails the
// build instead of shipping a broken page.
//
// A file's name is its URL: src/content/writing/on-call.md is /writing/on-call/.
// URLs never change, so never rename a published file.
import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const tag = z.string().regex(/^[a-z0-9-]+$/, 'tags are lower-case-with-hyphens');

/** Apps and projects I'm building or have built. */
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** One sentence: what it is and who it's for. */
      description: z.string(),
      status: z.enum(['active', 'shipped', 'paused', 'retired']),
      /** When it started, as YYYY-MM. Orders projects within a status. */
      started: z.string().regex(/^\d{4}-\d{2}$/, 'started is YYYY-MM'),
      /** Where to use it. */
      url: z.url().optional(),
      /** Source, only if the repository is public. */
      repo: z.url().optional(),
      /** Platform and main tools, e.g. ["Android", "Kotlin", "Strava API"]. */
      stack: z.array(z.string()).default([]),
      /** Pinned projects are linked from the home page. */
      pinned: z.boolean().default(false),
      /** Drafts never reach the production build. They show in `npm run dev`. */
      draft: z.boolean().default(false),
      /** Set when the write-up changes in substance. */
      updated: z.coerce.date().optional(),
      /**
       * A screenshot next to the Markdown file, e.g. `./loadmatter.png`. Shown on
       * the project page, converted to AVIF and WebP at build time.
       */
      screenshot: image().optional(),
      /** What the screenshot shows, for screen readers. Required with `screenshot`. */
      screenshotAlt: z.string().optional(),
    })
      .refine((d) => !d.screenshot || d.screenshotAlt, { message: '`screenshot` needs `screenshotAlt`', path: ['screenshotAlt'] }),
});

/** Blog posts: essays, notes and links. */
const writing = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/writing' }),
  schema: z
    .object({
      title: z.string(),
      /** One sentence. Used for the index, the meta description and RSS. */
      description: z.string(),
      /** The date shown on the post. A post goes live when it's pushed without `draft`. */
      date: z.coerce.date(),
      /** Set when the substance changes, not for typo fixes. */
      updated: z.coerce.date().optional(),
      format: z.enum(['essay', 'note', 'link']),
      /** For a link post: the one source it responds to. */
      link: z.url().optional(),
      /** The project this post is about, if any. The project page lists it. */
      project: reference('projects').optional(),
      /** Topics. Each tag gets a page listing its posts. */
      tags: z.array(tag).default([]),
      /** Pinned posts are linked from the home page, two at most. */
      pinned: z.boolean().default(false),
      draft: z.boolean().default(false),
      /** If I've changed my mind, the newer post. */
      supersededBy: reference('writing').optional(),
    })
    .refine((d) => d.format !== 'link' || d.link, { message: 'a link post needs `link`', path: ['link'] }),
});

export const collections = { projects, writing };
