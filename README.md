# nick-jones.me

Personal site. Static, built with [Astro](https://astro.build). DigitalOcean App Platform builds and deploys `master` through its GitHub integration; the spec is in `.do/app.yaml`.

## Where things live

| To change | Edit |
| --- | --- |
| Role, employer, dates, pitch, proof points, links | `src/data/profile.ts` (the only file a job change touches) |
| Nav items | `src/data/nav.ts` (Work, Positions and Writing appear once they hold a published entry) |
| Type, colour, spacing | `src/styles/tokens.css` |
| Page copy | `src/pages/*.astro` |
| Case studies | `src/content/work/*.md` |
| Essays, notes, links | `src/content/writing/*.md` |
| Positions (theses) | `src/content/positions/*.md` |
| Fields each content type takes | `src/content.config.ts` |

## Publishing a post

1. Add `src/content/writing/<url-slug>.md`. The file name is the URL, so don't rename it once it's live.
2. Frontmatter: `title`, `description` (one sentence), `date`, `format` (`essay`, `note` or `link`, plus `link:` for a link post) and `tags` (one per position). Optional: `pinned` (linked from the home page), `updated`, `supersededBy`, `draft`.
3. `npm run dev` shows drafts and future-dated posts with a banner. The production build leaves both out.
4. Push to `master`. A post dated today or earlier goes live with that deploy.
5. A post dated in the future goes live on its date: `.github/workflows/publish.yml` asks App Platform for a fresh build at 06:00 UTC on any day something is due. It needs a `DIGITALOCEAN_TOKEN` repository secret.

Case studies work the same way in `src/content/work/`. Optional extras: `claim`, `figure` with `figureLabel`, and `credits` (the "what others did" line). The build fails if a published case study doesn't end with a `## What went wrong or I'd change` section.

## Confidentiality

Meta work stays at resume level: role, scope and the kind of work. No internal metrics, tool or programme names, incidents or people. Case studies come from work you can publish in full. Essays can draw on experience in general terms ("on a large mobile app…"). Anything Meta has published itself, such as an engineering blog post or a talk, can be cited and linked.

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
