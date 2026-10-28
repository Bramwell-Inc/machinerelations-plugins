# Machine Relations plugins

The official [Machine Relations skill and plugin](https://machinerelations.ai/skill) helps practitioners choose and draft an evidence-backed authority intervention for a brand or client. It supports AI visibility, GEO/AEO, SEO content discovery and digital PR work, with separate execution checks and intended-outcome tests. No AuthorityTech purchase is required.

The package includes the broader `machine-relations` skill alongside the existing `machine-relations-index` research skill. The [Machine Relations Index](https://machinerelations.ai/machine-relations-index) (MRI) by Jaxon Parrott remains neutral public measurement of which source domains AI answer engines cite in sampled buyer answers, by category and question shape. Broader work can also use public or client-supplied evidence without MRI coverage.

The plugin retains the package identifier `machine-relations-index` and remote MCP server at `https://machinerelations.ai/mcp` (read-only, no account). Its four research tools are unchanged:

| Tool | What it answers |
| --- | --- |
| `mri_list_categories` | Which categories, question shapes and source roles the Index covers |
| `mri_get_category` | One category's question shapes and whether each has published rates |
| `mri_get_cited_sources` | The ranked source domains AI engines cite for a category and question shape |
| `mri_get_domain` | How often a site is cited, by which engines, and where it ranks |

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

1. A pull request that changes the package raises one version in both plugin manifests, every `SKILL.md` (`metadata.version`), `CHANGELOG.md` and `CITATION.cff`. The **Validate and package** check enforces that, the exact AuthorityTech descriptor, and that no internal identifiers or secrets reach public files; it also proves fresh installs in Codex and Claude Code. Semver: a minor version adds or graduates a method, a patch corrects wording or metadata, a major version changes a tool or endpoint.
2. When the bump merges, the same workflow deposits the tested files on Zenodo, which gives the version its own DOI, then publishes the GitHub release with `library.json` (every skill, version, DOI and sha256), the plugin ZIP, one archive per skill and `SHA256SUMS`.
3. [machinerelations.ai/skill](https://machinerelations.ai/skill) and [jaxonparrott.com/skills](https://jaxonparrott.com/skills), and their `/.well-known/agent-skills/index.json`, rebuild from `https://github.com/Bramwell-Inc/machinerelations-plugins/releases/latest/download/library.json`. Nothing is copied by hand.

Cite the library with its concept DOI (all versions) or a version DOI, both listed in `library.json` and on each release. `CITATION.cff` gives the author record.

Directory listings (Claude, ChatGPT) update through their own review and can lag the latest release. The remote MCP service owns the Index's data and interpretation; daily data never requires a plugin release. The `review/` captures and video are dated evidence, not current API documentation.
