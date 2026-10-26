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

## Maintaining and releasing the plugin

The remote service owns API behavior and interpretation. Do not copy daily counts, capability rollout status or the interpretation rules into this package. Internal maintainers: the service source is `Bramwell-Inc/machinerelations.ai`, with rules in `lib/mri-agent-guidance.ts` and consumer/release boundaries in `docs/mri-agent-releases.md`; agents using this public plugin need only the returned guidance.

Change this repository when tool names/arguments, endpoint/auth, installation, skill routing or interface assets change. Keep both plugin manifests on one package version. The **Validate and package** GitHub workflow requires a version increase when packaged files change, rejects version/endpoint/path drift, and builds the exact commit's directory ZIP on every PR and main push. Its artifact is named `machine-relations-index-<version>-<commit>` and includes the package and a SHA-256 receipt. Install/update from this repository to consume its latest package; existing installations and submitted ZIPs are not silently replaced by a merge.

**External directory seam:** Claude's repository-backed submission already checks for new commits about every six hours; its **Check for new commits** control can request an immediate scan. Use that native update path, not a second polling job or a fresh submission. A detected commit is not approval: the portal currently requires an Anthropic reviewer before a new version goes live. OpenAI's uploaded package is a separate snapshot; the release owner checks its developer portal before replacing a submitted version. Download the tested ZIP from that commit's workflow when a portal needs an upload. Record the package version, source commit, ZIP checksum, portal receipt and review state under Brain's **MRI agent API** project. Keep pending review snapshots and evidence intact unless intentionally superseding them. A GitHub artifact is not directory approval; user-only legal acknowledgments or account actions remain with the account owner. The official MCP Registry describes the remote server, so a skill-only patch does not require changing its server version. Alexandria owns its provider acceptance separately.

The `review/` captures and video are dated evidence, not current API documentation. Refresh them when the reviewed behavior changes; never overwrite their date to imply a fresh test. No periodic sync job is needed.
