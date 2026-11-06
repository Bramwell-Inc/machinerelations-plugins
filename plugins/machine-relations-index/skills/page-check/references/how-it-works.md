# How the page check works

The page check reads a site the way people and machines read it. In CI it runs on every pull request against that commit's Vercel preview, with nothing to configure per site: a repository with a Vercel project is checked, any other passes untouched. Run locally, it reads any URL you give it (see the skill).

## What it does

1. In CI, finds this commit's Vercel preview from the GitHub Deployment Vercel records on the repo, and the production domain from the preview's own sitemap (`resolve.mjs`). No stored secret: GitHub's own token reads the deployment, and the run's OIDC identity gets past preview protection on any Vercel project that lists this org's GitHub Actions as a Trusted Source for previews (`access.mjs`). A protected preview that refuses the run is a loud warning, never a block.
2. Reads the sitemap and groups pages by route (`/blog/*`, `/index/domains/*`…).
3. **Sweep:** reads up to 1,500 pages as plain HTML (every page type, big types get more) for printed raw values, and learns which page of each type is fullest and which carries a table or code block. Pages this pull request edits (a changed `content/posts/foo.md` matches `/blog/foo`) are always read. About a minute.
4. **Render:** per page type, its fullest page (a table or code block if any page has one) and its longest-named page, plus up to six pages this PR edits. Renders each at 390, 1024 and 1440 wide, light and dark, and measures:
   - **Layout:** sideways scroll, text cut off or off screen, text over text or over a control, broken images.
   - **Readability:** running text at 10px or smaller (11px, and short capitalised labels at 10px, are notes), tap targets under 24px with a neighbour too close, text that vanishes in dark mode, axe (WCAG 2.2 AA; critical and serious only block).
   - **Words:** `null`, `undefined`, `NaN`, `[object Object]`, unfilled `{{slots}}`, raw UUIDs, versioned internal ids (`mri_score_v2.1+…`) and status codes (`release_unavailable`); other snake_case is a note, "1 answers" (not "Tier 1 outlets" or "Layer 1 works"), placeholder copy.
   - **Generated images:** every same-site SVG badge or embed, opened alone, each line of text measured against its box.
   - **Links:** every same-site link answers.
   - **Machines (Agentic 100):** `llms.txt`, a real 404 for a missing page, the Markdown twin of each page (`Accept: text/markdown`), `og:image` that loads, JSON-LD that parses.
5. Renders any page that has a problem again on production. **Only problems production does not have block**, and a rendered problem must show again on a second look at the preview (one render is a sample: fonts, fades and late scripts move). Problems production already has are listed, folded, and never block, so an old flaw never holds up an unrelated change.
6. One PR comment, edited in place, only when something needs reading. Optional taste notes (Claude looking at the screenshots against the site's design layer) are added there and never block.

No pixel diff: it judges the page, not its change from last time.

## Reading a finding

Each line names the problem, the page type and widths where it happens, and the element (a short selector plus its text). Open the screenshot in the run's `page-check-report` artifact, fix it at the source (the component or the data that produced it, not the one page), push, and the comment updates.
