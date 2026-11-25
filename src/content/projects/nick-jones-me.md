---
title: nick-jones.me
description: This site. Static HTML held to a performance and accessibility budget, with checks that block a bad deploy.
status: active
started: 2026-11
url: https://nick-jones.me
repo: https://github.com/njhazelh/nick-jones.me
stack: [Astro, DigitalOcean App Platform]
screenshot: ./nick-jones-me.png
screenshotAlt: The home page of this site on a phone, showing the one-line pitch and the start of the background.
draft: true # TODO: check the write-up, then remove draft
---

A personal site built to need no upkeep beyond writing. Every page is plain HTML that reads the same with JavaScript off. One small script draws the pixel critters in the margins, and the home page stays under 100 KB. Facts that date, like my role and how long I held it, live in one data file and are computed at build time. Every deploy checks for stale wording, requests to other hosts and the page budget, and stops if one fails.

The [Colophon](/colophon/) has the details: what it's made of, the budgets it holds and the options I turned down.
