# Machine Relations plugins

The official [Machine Relations skill and plugin](https://machinerelations.ai/skill) helps practitioners choose and draft an evidence-backed authority intervention for a brand or client. It supports AI visibility, GEO/AEO, SEO content discovery and digital PR work, with separate execution checks and intended-outcome tests. No AuthorityTech purchase is required.

The package includes the broader `machine-relations` skill, the `machine-relations-index` research skill and the `page-check` skill. Page check tells you how to render a site the way people and AI engines read it and report what breaks before a change ships. The checker is public source at `actions/page-check/runtime`, and the GitHub Action `actions/page-check` runs it. It is not a file inside the installed package. An organization can require the same check on every pull request with one ruleset pointing at `.github/workflows/page-check.yml`. The [Machine Relations Index](https://machinerelations.ai/machine-relations-index) (MRI) by Jaxon Parrott remains neutral public measurement of which source domains AI answer engines cite in sampled buyer answers, by category and question shape. Broader work can also use public or client-supplied evidence without MRI coverage.

The plugin retains the package identifier `machine-relations-index` and remote MCP server at `https://machinerelations.ai/mcp` (read-only, no account). It exposes six research tools:

| Tool | What it answers |
| --- | --- |
| `mri_list_categories` | Which categories, question shapes and source roles the Index covers |
| `mri_get_category` | One category's question shapes and whether each has published rates |
| `mri_get_cited_sources` | The ranked source domains AI engines cite for a category and question shape |
| `mri_get_domain` | How often a site is cited, by which engines, and where it ranks |
| `mri_list_engines` | Which engines have observations and published evidence |
| `mri_get_engine` | One engine’s cited-source leaderboard over the observed window, optionally limited to sources with a published segment in a category |

## Install

**Codex**

```bash
codex plugin marketplace add Bramwell-Inc/machinerelations-plugins
```

Then install the **Machine Relations** package (identifier `machine-relations-index`) from that marketplace. Published directory versions may still display **Machine Relations Index**; verify that your installed version includes `machine-relations` before expecting the broader workflow.

**Claude Code**

```text
/plugin marketplace add Bramwell-Inc/machinerelations-plugins
/plugin install machine-relations-index@machinerelations
```

**Any MCP client**: add a remote (streamable HTTP) server with URL `https://machinerelations.ai/mcp`. It is also listed in the official MCP Registry as `ai.machinerelations/mri`.

**No MCP**: the same reads are a JSON API at `https://machinerelations.ai/api/mri/v2` ([OpenAPI](https://machinerelations.ai/api/mri/v2/openapi.json)).

An MCP connection alone supplies research tools; it does not install the skill. The broader skill is at `plugins/machine-relations-index/skills/machine-relations/SKILL.md` for compatible skill hosts. New instructions do not require changing Editor's private method, the App journey or the Index's measurement.

## Data

Every response carries its release ID, the artifact hash and a citation string. MRI data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Dataset citation: Machine Relations Index (MRI) by Jaxon Parrott, Machine Relations Research — machinerelations.ai. https://machinerelations.ai/index. https://doi.org/10.5281/zenodo.23652423. Methodology: <https://machinerelations.ai/machine-relations-index>.

The plugin package in this repository is MIT licensed.

## Use and interpretation

Start with the [worked example](https://machinerelations.ai/research/segment-rank-question-set-named-brand-citations) and [agent entry point](https://machinerelations.ai/index#use-with-ai-agents). The example preserves one historical release; it is not a live leaderboard.

Every successful current data read includes `source.guidance`, the live interpretation rules. The skill directs agents there and to any field-specific method and limitations. Daily data and interpretation updates therefore do not require rebuilding this plugin. Missing or null question context is unavailable, never zero; the service describes what the current release actually contains.

## Releases and citation

Every version is released once, from a reviewed pull request, and the release is the single source for everything else:

1. A pull request that changes the package raises one version in both plugin manifests, every `SKILL.md` (`metadata.version`), `CHANGELOG.md` and `CITATION.cff`. The **Validate and package** check enforces that, the exact AuthorityTech descriptor, and that no internal identifiers or secrets reach the README, changelog, citation or packaged plugin files; it also proves fresh installs in Codex and Claude Code. Semver: a minor version adds or graduates a method, a patch corrects wording or metadata, a major version changes a tool or endpoint.
2. When the bump merges, the same workflow deposits the tested files on Zenodo (it rebuilds `library.json` with the reserved DOIs and refuses to continue if any other file differs from the tested build), which gives the version its own DOI, then publishes the GitHub release with `library.json` (every skill, version, DOI and sha256), the plugin ZIP, one archive per skill and `SHA256SUMS`.
3. [machinerelations.ai/skill](https://machinerelations.ai/skill) and [jaxonparrott.com/skills](https://jaxonparrott.com/skills), and their `/.well-known/agent-skills/index.json`, rebuild from `https://github.com/Bramwell-Inc/machinerelations-plugins/releases/latest/download/library.json`. Nothing is copied by hand.

Cite the library with its concept DOI, [10.5281/zenodo.23749768](https://doi.org/10.5281/zenodo.23749768) (all versions); cite a version DOI only for work that used that exact version. Both are in `library.json` and on each release. `CITATION.cff` gives the author record. The library's Wikidata item is [Q141909117](https://www.wikidata.org/wiki/Q141909117).

A skill can carry `metadata.title` and `metadata.summary` (a human name and a one-sentence practitioner summary; not the `description` trigger text). Pages use them when present.

Directory listings (Claude, ChatGPT) update through their own review and can lag the latest release. The remote MCP service owns the Index's data and interpretation; daily data never requires a plugin release. The `review/` captures and video are dated evidence, not current API documentation.


### Finish the directory and Wikidata handoff

A GitHub release is not proof that a directory has published it. These steps are
for a maintainer with authorized publisher access; downloading public artifacts
requires no publisher credentials. Do not create a replacement listing or rebuild
the ZIP from a newer checkout.

1. Select one immutable tag from [Releases](https://github.com/Bramwell-Inc/machinerelations-plugins/releases).
   Download that tag's `library.json`, `machine-relations-index.zip` and
   `SHA256SUMS`. Verify the manifest and ZIP against `SHA256SUMS`, and the ZIP
   against `library.package.sha256`. Use `library.version`, `library.released`,
   `library.source.release_url` and `library.doi.version` throughout the handoff.
   Do not mix a pinned ZIP with a later `latest` manifest.
2. **ChatGPT:** hosted tool changes reach the listing through OpenAI's daily
   scan of the MCP server, with no new ZIP; metadata and skill changes need one.
   Uploading, submitting and publishing happen only in the OpenAI Plugins portal,
   as an organization owner or a member with Apps Management Write; there is no
   API for them. In the existing Machine Relations publisher listing, choose
   **Create draft from ZIP**, upload the verified ZIP, then inspect the draft's
   version, skills, tools, server instructions, metadata and scan findings before
   submitting for review. Compare skills with `library.skills`; this package
   currently exposes six MCP tools, not four. Do not submit an older draft over a
   newer submitted or published version. Submission is not publication: completion
   means the publisher record says **Published** for the intended version and the
   [public listing](https://chatgpt.com/plugins/plugin_asdk_app_6abff210fc508191ba0bbe0e96fd11e1)
   agrees wherever it exposes the same fields. Record anything not publicly visible
   as publisher-only evidence. An OpenAI API key is not publisher access.
3. **Claude:** the existing plugin listing scans changes on `main`. Read its
   newest-version scan and policy result in the publisher portal. A policy hold
   needs its stated cause fixed in the repository; a passed scan still does not
   mean the version is live. Keep the existing submission, and distinguish
   **Approved / ready to publish** from the published version. Never add credentials
   to the installed plugin to make a directory check pass: protected-preview and
   pull-request integration belongs under `actions/`, outside `plugins/`.
4. **Wikidata:** nothing to edit by hand.
   [Github-wiki-bot](https://www.wikidata.org/wiki/User:Github-wiki-bot) imports
   every stable GitHub release of this repository into Q141909117, usually within
   a day: `software version identifier` (P348) with `publication date` (P577),
   `version type` = stable version and the GitHub release as reference, and
   preferred rank on the newest release. Leave version statements to it. After
   its pass, read [Q141909117's claims](https://www.wikidata.org/w/api.php?action=wbgetentities&ids=Q141909117&props=claims&format=json)
   and confirm that `library.version` is the preferred P348, dated
   `library.released`. If a release is still missing after two days, check the
   bot's [exceptions](https://www.wikidata.org/wiki/User:Github-wiki-bot/Exceptions)
   before editing. The item's DOI (P356) is the concept DOI and stays unchanged;
   version DOIs live on Zenodo and in `library.doi.version`.

The existing fresh-install check also reads both public discovery aliases on both
sites with a named agent and Python's standard-library user agent. Run
`node scripts/verify-public-discovery.mjs` after changing their edge rules. This
checks the currently published catalog, not candidate-version propagation or
archive bytes. A working browser or MCP connection alone does not prove skill
discovery works. Where Browser Integrity Check rejects these public reads, use a
host/path/method-scoped configuration rule for GET/HEAD on
`/.well-known/agent-skills` and `/.well-known/agent-skills/index.json`; do not
turn off zone-wide protection or skip unrelated security products.

If authorized publishing access is absent, stop at the verified artifact handoff
and name the missing access. Do not extract another browser's cookies, bypass an
access refusal, or call a draft, scan approval or local plan a published update.
