---
name: page-check
description: Use when building, changing or reviewing a website or page and you need to know whether people and AI engines can read it, before it ships. Renders a preview or live site from its own sitemap at phone, tablet and desktop widths in light and dark, and reports broken layout, unreadable text, raw values printed to readers, broken links and images, and gaps in what machines read (llms.txt, Markdown twins, JSON-LD, og:image, 404s).
metadata:
  version: "1.2.0"
  title: "Page check"
  summary: "Check that every page type of a site reads cleanly for people and for AI engines, and fix only what a change adds, before it ships."
---

# Page check

A page earns citations only if people and machines can both read it. This skill renders a site the way each reads it and tells you what is broken, where, and how to fix it at the source. Run it on a preview before you open or merge a change, or on any live site you are reviewing.

## Run it

The checker lives in `scripts/` next to this file. It needs Node 20 or later and downloads one headless Chromium the first time.

```bash
cd <this skill folder>/scripts
npm ci --no-audit --no-fund
npx playwright@1.49.1 install chromium
node page-check.mjs --url <preview or site URL> --base <production URL> --out page-check-report
```

- `--base` is the live site the change will replace. Problems the live site already has are listed but never counted against the change. Leave it out to judge the site on its own.
- `--changed files.txt` (optional): one changed file path per line; the pages those files produce are always read and rendered first.
- A Vercel preview behind protection: pass `--bypass` with the project's automation bypass value only if the person you work for gives it to you, or ask them to add the repo's GitHub Actions as a Trusted Source and let CI run it.

It takes one to seven minutes depending on the site's size. Exit code 1 means something blocks.

## Read and fix

`page-check-report/summary.md` lists each blocking problem with the page type, the widths where it happens and the element (a short selector and its text). `report.json` holds every finding; screenshots sit beside them.

1. Fix each blocking problem where it is produced: the component, the template or the data, never the one page.
2. Run again on the new preview until nothing blocks.
3. Read the notes. They never block, but they are where taste lives: small type, tight tap targets, snake_case text, and optional design notes when an Anthropic key is present.

What each rule measures and why: [how it works](references/how-it-works.md).

## In CI

The same scripts run as a GitHub Action from this folder (`action.yml`). An organization can require them on every pull request with one ruleset that points at `.github/workflows/page-check.yml` in this repository; a repository Vercel never deploys passes untouched. The check never needs a stored secret, and a checker that breaks warns instead of blocking.

Do not judge a page by memory or by its source alone; render it. Do not claim a page is readable to AI engines without the machine checks passing.
