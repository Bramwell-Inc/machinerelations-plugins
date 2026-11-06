# How the page check works

The page check reads a site the way people and machines read it. In CI it runs on a pull request against that commit's Vercel preview, with nothing to configure per site. Run locally from `actions/page-check/runtime` in the Machine Relations plugins repository, it reads any URL you give it (see the skill). The installed skill does not contain that program. The pull request comment is the result, and it uses one of three names.

- **Clean.** This run finished with exit 0, and its report lists nothing that blocks. A report left from an earlier run is not clean.
- **Blocking.** The sampled pages were read. This change adds a defect production does not already show. The job fails.
- **Not judged.** The pages were not read. The job stays green so a broken or skipped check does not hold every merge.

Not judged covers a repository Vercel has never deployed, a preview that refused this run, a preview that did not build, a site whose production domain could not be read, a missing or unreadable report, and a checker exit other than 0 while that report lists nothing blocking. Those runs stay green. Clean is exit 0 and an empty blocking list from the report this run wrote. The output directory is cleared before the checker starts. AuthorityTech keeps its own copy of the caller. A test in this repository that cannot read that file is not coverage of it.

## What a green job does not cover

Requiring this workflow blocks a merge when the result is blocking. It does not read the pages on a not-judged run, and it does not run on a push straight to the default branch. A defect those pushes ship becomes the production baseline a later pull request is compared with. The pushes that publish a release or sync content include:

- AuthorityTech/website: `external-content-sync.yml`, `publication-profiles-refresh.yml`, `agentic-scan.yml`
- Bramwell-Inc/machinerelations.ai: `index-report.yml`, `hub-evidence.yml`, `mri-dataset-publish.yml`
- Bramwell-Inc/paralax.ai: `engine-changes.yml`, `mri-engine-measures.yml`

The shared merge gate counts a skipped Page check as passed. Page check is not one of the checks that gate requires to be present. jaxonparrott.com pins that gate to a commit, so a note in this repository does not change what that site requires. A skipped or absent Page check can merge.

Preview access for a protected deployment is a setting on each Vercel project. Another project's setting does not cover a new one. The bramwell.ai project is separate from the seven sites this check already runs for, and a refusal there is not judged. The installed skill does not include the checker. The public checker reads only public pages. Taste notes stay optional: they appear when the caller passes an API key, they never block, and the check does not fetch a design document on its own.

Rendered pages are the fullest page and the longest-named page of the largest sitemap types, up to 18 types, plus up to six pages whose slug matches a changed file. Files named layout, page, route, index, data or readme are not matched to a URL. Types past those 18 are read as HTML for printed raw values and are not rendered. A shared header is still seen, because the home page and the large types are rendered.

## What it does

1. In CI, finds this commit's Vercel preview from the GitHub Deployment Vercel records on the repo, and the production domain from the preview's own sitemap (the action's `resolve.mjs`). No stored secret: GitHub's own token reads the deployment, and the run's OIDC identity gets past preview protection on any Vercel project that lists this org's GitHub Actions as a Trusted Source for previews (the action's `access.mjs`). The checker it runs is `actions/page-check/runtime`, also outside the installed plugin, so the directory package never handles a credential or ships the program. A protected preview that refuses the run is not judged. The comment says so, and the job does not fail.
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
6. One pull request comment, edited in place, on every run. It says clean, blocking, or not judged. Optional taste notes, when the caller passes an API key and any design text it wants used, are added on a judged run and never block.

No pixel diff: it judges the page, not its change from last time.

## Reading a finding

Each line names the problem, the page type and widths where it happens, and the element (a short selector plus its text). Open the screenshot in the run's `page-check-report` artifact, fix it at the source (the component or the data that produced it, not the one page), push, and the comment updates.
