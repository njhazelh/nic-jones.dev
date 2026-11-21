// Posts and case studies in one feed, newest first. Drafts and future-dated
// entries are left out, the same as everywhere else.
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { profile } from '../data/profile';
import { posts, caseStudies, hrefFor } from '../lib/content';

export async function GET(context: APIContext) {
  const entries = [...(await posts()), ...(await caseStudies())].sort(
    (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
  );
  return rss({
    title: `${profile.name}: writing`,
    description: profile.pitch,
    site: context.site!,
    items: entries.map((e) => ({
      title: e.data.title,
      description: e.data.description,
      pubDate: e.data.date,
      link: hrefFor(e),
      categories: e.data.tags,
    })),
    customData: '<language>en-gb</language>',
  });
}
