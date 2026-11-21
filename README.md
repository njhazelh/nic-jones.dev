# nick-jones.me

Personal site. Static, built with [Astro](https://astro.build). DigitalOcean App Platform builds and deploys `master` through its GitHub integration; the spec is in `.do/app.yaml`.

## Where things live

| To change | Edit |
| --- | --- |
| Role, employer, dates, pitch, proof points, links | `src/data/profile.ts` (the only file a job change touches) |
| Nav items | `src/data/nav.ts` (Projects and Writing appear once they hold a published entry) |
| Type, colour, spacing | `src/styles/tokens.css` |
| Page copy | `src/pages/*.astro` |
| Projects | `src/content/projects/*.md` |
| Blog posts (essays, notes, links) | `src/content/writing/*.md` |
| Fields each content type takes | `src/content.config.ts` |
| Link-preview cards (Open Graph images) | `src/lib/og.ts`; a new kind of page needs an entry in `cards()` |

## Adding a project

1. Add `src/content/projects/<url-slug>.md`. The file name is the URL (`/projects/<url-slug>/`), so don't rename it once it's live.
2. Frontmatter: `title`, `description` (one sentence), `status` (`active`, `shipped`, `paused` or `retired`) and `started` (`YYYY-MM`). Optional: `url`, `repo` (public repositories only), `stack`, `pinned` (shown on the home page), `updated`, `draft`.
3. The body is an optional write-up: what it is, why you built it, what you learned.

## Publishing a post

1. Add `src/content/writing/<url-slug>.md`. The file name is the URL, so don't rename it once it's live.
2. Frontmatter: `title`, `description` (one sentence), `date`, `format` (`essay`, `note` or `link`, plus `link:` for a link post). Optional: `project` (a project's file name; its page lists the post), `tags`, `pinned`, `updated`, `supersededBy`, `draft`.
3. `npm run dev` shows drafts with a banner. The production build leaves them out.
4. Remove `draft: true` and push to `master`. App Platform deploys it.

## Confidentiality

Meta work stays at resume level: role, scope and the kind of work. No internal metrics, tool or programme names, incidents or people. Projects are your own work, so they can be described in full. Posts can draw on experience in general terms ("on a large mobile app…"). Anything Meta has published itself, such as an engineering blog post or a talk, can be cited and linked.

`npm run check` fails on a line that mentions Meta, Instagram, Facebook or WhatsApp next to a percentage, a multiplier or a word like "halved", unless the same line links a public source.

Durations such as "nearly nine years" are computed from role dates at build time, so they never go stale.

## Commands

```sh
npm ci
npm run dev        # local server at http://localhost:4321
npm run build      # static output in dist/
npm run check      # stale-copy lint, third-party request scan, 100 KB home-page budget
```

The DigitalOcean build runs `npm run build && npm run check`, so a failing check blocks the deploy. GitHub Actions (`.github/workflows/checks.yml`) also runs axe (WCAG 2.1 AA, every page in the sitemap, light and dark) and Lighthouse (fails under 95 in any category) on every PR. Those need a browser, so they don't run in the DigitalOcean build. To run them locally:

```sh
npm install --no-save playwright@1.65 axe-core@4 && npx playwright install chromium
npm run preview &   # then:
npm run check:browser
```

## Rules the checks enforce

- No "currently", "recently", "this year", "weekly" or "latest post" in copy. Facts that date go in the data file.
- No request to any third-party host. Fonts are self-hosted (Source Serif 4, OFL, `public/fonts/`).
- No phone number anywhere in the build.
- Values marked `TODO:` in the data file and in drafts are printed as warnings until confirmed.
- A `TODO` in a content entry that isn't `draft: true` fails the check, so a half-written post can't ship.
