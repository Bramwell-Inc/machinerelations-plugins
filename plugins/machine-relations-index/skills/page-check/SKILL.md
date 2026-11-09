---
name: page-check
description: Use when building, changing or reviewing a website or page and you need to know whether people and AI engines can read it, before it ships. Run the public page checker from the Machine Relations plugins repository. It renders a preview or live site from its own sitemap at phone, tablet and desktop widths in light and dark, and reports broken layout, unreadable text, raw values printed to readers, broken links and images, and gaps in what machines read (llms.txt, Markdown twins, JSON-LD, og:image, 404s).
metadata:
  version: "1.2.5"
  title: "Page check"
  summary: "Check that every page type of a site reads cleanly for people and for AI engines, and fix only what a change adds, before it ships."
---

# Page check

A page earns citations only if people and machines can both read it. This skill tells you how to run the public page checker. The checker renders a site the way each reads it and tells you what is broken, where, and how to fix it at the source. Run it on a preview before you open or merge a change, or on any live site you are reviewing.

## Run it

This installed skill does not contain the checker. The checker is public source in the [Machine Relations plugins repository](https://github.com/Bramwell-Inc/machinerelations-plugins), at `actions/page-check/runtime`. The GitHub Action `actions/page-check` runs that same source. It needs Node 20 or later and downloads one headless Chromium the first time you run it from a checkout of that repository.

```bash
cd actions/page-check/runtime
npm ci --no-audit --no-fund
npx playwright@1.49.1 install chromium
node page-check.mjs --url <preview or site URL> --base <production URL> --out page-check-report
```

- `--base` is the live site the change will replace. Problems the live site already has are listed but never counted against the change. Leave it out to judge the site on its own.
- `--changed files.txt` (optional): one changed file path per line; the pages those files produce are always read and rendered first.
- A Vercel preview behind protection: a local run of the public checker can't open it. Check the public production site, or let the pull request's CI check run it (see In CI).

It takes one to seven minutes depending on the site's size. Exit code 1 means something blocks. In CI, a run that does not finish is reported as not judged and the job passes. That result is separate from clean.

## Read and fix

`page-check-report/summary.md` lists each blocking problem with the page type, the widths where it happens and the element (a short selector and its text). `report.json` holds every finding; screenshots sit beside them.

1. Fix each blocking problem where it is produced: the component, the template or the data, never the one page.
2. Run again on the new preview until nothing blocks.
3. Read the notes. They never block, but they are where taste lives: small type, tight tap targets, snake_case text, and optional design notes when an Anthropic key is present.

What each rule measures and why: [how it works](references/how-it-works.md).

## In CI

The checker reads public pages and handles no credentials. To check a protected preview, run it from the GitHub Action in this repository (`actions/page-check`), which adds the run's own identity and posts the result on the pull request. The Action uses `actions/page-check/runtime`, the same source as a local run. An organization can run it on every pull request with one ruleset that points at `.github/workflows/page-check.yml` in this repository. A repository Vercel never deploys is not judged, and the comment says so. The check never needs a stored secret. A checker that does not finish, or a preview this run cannot open, is reported as not judged and the job passes. The comment uses three names: clean, blocking, or not judged. What a green job does not cover is in [how it works](references/how-it-works.md).

Do not judge a page by memory or by its source alone; render it. Do not claim a page is readable to AI engines without the machine checks passing.
