# nick-jones.me

Personal site. Static, built with [Astro](https://astro.build), deployed to GitHub Pages by `.github/workflows/site.yml`.

## Where things live

| To change | Edit |
| --- | --- |
| Role, employer, dates, pitch, proof points, links | `src/data/profile.ts` (the only file a job change touches) |
| Nav items | `src/data/nav.ts` (an item shows once `live: true`) |
| Type, colour, spacing | `src/styles/tokens.css` |
| Page copy | `src/pages/*.astro` |

Durations such as "nearly nine years" are computed from role dates at build time, so they never go stale.

## Commands

```sh
npm ci
npm run dev        # local server at http://localhost:4321
npm run build      # static output in dist/
npm run check      # stale-copy lint, third-party request scan, 100 KB home-page budget
```

CI also runs axe (WCAG 2.1 AA, light and dark), Lighthouse (fails under 95 in any category) and prints the resume to `/resume.pdf`. Those need a browser, so they run only in CI.

## Rules the checks enforce

- No "currently", "recently", "this year", "weekly" or "latest post" in copy. Facts that date go in the data file.
- No request to any third-party host. Fonts are self-hosted (Source Serif 4, OFL, `public/fonts/`).
- No phone number anywhere in the build.
- Values marked `TODO:` in the data file are printed as warnings until confirmed.
