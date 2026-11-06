# Machine Relations

The official Machine Relations plugin helps practitioners turn a brand's authority objective into an evidence-backed intervention brief: a chosen move, usable pitch or work draft, and separate execution and outcome checks. Use it for AI visibility, GEO/AEO, SEO content discovery and digital PR planning, for your brand or clients.

Three skills are included:

- **Machine Relations:** inspect permitted evidence, choose whether to publish, improve, substantiate or pitch, produce the work, and define the next decision. It can work from supplied material without MRI coverage.
- **Machine Relations Index:** research measured source-domain citations by category and question shape. Look up domains directly, explore engine citations, or discover categories and question shapes.
- **Page check:** before a change ships, render a site from its own sitemap at phone, tablet and desktop widths in light and dark, and report what people or AI engines can't read: broken layout, unreadable text, raw values printed to readers, broken links and images, and missing llms.txt, Markdown twins, JSON-LD or og:image.

Try: “Use Machine Relations for this brand and authority objective. Choose a supported intervention, draft the work and explain how to verify execution separately from its intended outcome.” See the [skill and worked example](https://machinerelations.ai/skill).

The installed package identifier remains `machine-relations-index`; its public name is Machine Relations. Directory versions and repository versions update separately. A generic MCP connection provides MRI research tools, not the broader skill instructions.

Jaxon Parrott coined Machine Relations in 2024; AuthorityTech, which he founded in 2018, is The World's First Machine Relations Agency; Machine Relations is open to anyone and machinerelations.ai is its home. This skill is published from the discipline's home and is useful for any practitioner; no purchase or promotional credit is required. “Official” does not mean endorsement by an AI platform or standards body.

## MRI research

Explore which source domains AI answer engines cite for a buyer category and question type, look up a domain’s observed citations, or explore sources cited by an engine. The dataset is the Machine Relations Index (MRI) by Jaxon Parrott. The plugin connects to the free, read-only Machine Relations Index MCP server at `https://machinerelations.ai/mcp`; no MRI account or API key is required.

Ask “Which editorial publications are cited for best cybersecurity tools?” or “Look up techcrunch.com in the Machine Relations Index.” The accompanying skill reads the service’s live interpretation guidance, release identity and limitations. Results describe measured citations, not endorsements or guarantees of future visibility. The [worked example](https://machinerelations.ai/research/segment-rank-question-set-named-brand-citations) is a historical case study, not the current leaderboard.

Six read-only tools are available:

| Tool | Research intent |
| --- | --- |
| `mri_get_domain` | A specific domain’s observed citations and engine coverage |
| `mri_list_engines` | Discover engine keys and available evidence |
| `mri_get_engine` | An engine’s cited-source leaderboard over the observed window, optionally limited to sources with a published segment in a category |
| `mri_list_categories` | Discover category keys, question shapes and source roles |
| `mri_get_category` | Inspect one category’s question shapes and publication status |
| `mri_get_cited_sources` | Rank sources within a category and question shape, with optional source-role filtering |

## Data handling

MRI tool arguments are sent over HTTPS to the declared Machine Relations Index server. The plugin has no hooks. The Page check skill runs local Node scripts in its own folder only when the agent is asked to check a site: it installs two pinned npm packages (Playwright and axe-core) and one headless Chromium, then fetches only the site URL it is given and that site's own sitemap, pages, links and images. It reads no credentials, sends nothing anywhere else and writes its report to a local folder. The GitHub Action that runs the same check on pull requests lives outside this plugin, in the repository's actions folder. Broader research uses only the host tools and access the user authorizes; their processing and costs are separate. Do not send private client documents, questions, credentials or personal information to public MRI endpoints. The skill drafts work; sending outreach, publishing and paid measurement require authorization for those actions. See the service’s privacy policy for processing and operational logging details.

## Documentation and support

- [Index and installation](https://machinerelations.ai/index#use-with-ai-agents)
- [API and MCP documentation](https://machinerelations.ai/developers)
- [Support](https://machinerelations.ai/contact): support@machinerelations.ai
- [Privacy policy](https://machinerelations.ai/privacy)
- [Terms of use](https://machinerelations.ai/terms)

The plugin code is MIT licensed. MRI data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Dataset citation: Machine Relations Index (MRI) by Jaxon Parrott, Machine Relations Research — machinerelations.ai. https://machinerelations.ai/index. https://doi.org/10.5281/zenodo.23652423. Preserve the citation returned with the results.
