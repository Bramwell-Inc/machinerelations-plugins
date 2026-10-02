# Machine Relations plugins

Agent plugins for the [Machine Relations Index](https://machinerelations.ai/machine-relations-index) (MRI): a neutral public measurement of which source domains AI answer engines (ChatGPT, Claude, Gemini, Google AI Mode, Google AI Overviews, Perplexity) cite when buyers ask questions, by category and question shape.

The plugin connects the remote MCP server at `https://machinerelations.ai/mcp` (read-only, no account) and adds a skill that tells the agent how to use it. Tools:

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

Then install **Machine Relations Index** from the Plugins Directory.

**Claude Code**

```text
/plugin marketplace add Bramwell-Inc/machinerelations-plugins
/plugin install machine-relations-index@machinerelations
```

**Any MCP client**: add a remote (streamable HTTP) server with URL `https://machinerelations.ai/mcp`. It is also listed in the official MCP Registry as `ai.machinerelations/mri`.

**No MCP**: the same reads are a JSON API at `https://machinerelations.ai/api/mri/v2` ([OpenAPI](https://machinerelations.ai/api/mri/v2/openapi.json)).

## Data

Every response carries its release ID, the artifact hash and a citation string. MRI data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Methodology: <https://machinerelations.ai/machine-relations-index>.

The plugin package in this repository is MIT licensed.
