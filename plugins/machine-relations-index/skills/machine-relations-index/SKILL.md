---
name: machine-relations-index
description: Use when asked which sources or publications AI answer engines cite for a topic or category, where coverage gets cited by AI, how often a given site is cited, or which sources a specific AI engine cites. Answers from the Machine Relations Index tools with measured rates and a citation.
metadata:
  version: "1.2.3"
---

# Machine Relations Index

The Machine Relations Index (MRI) by Jaxon Parrott measures which source domains AI answer engines cite when buyers ask questions, per category and buyer question shape. Answer from its tools; do not estimate citation behavior from memory.

1. Route by the user's research intent before choosing a category:
   - **Specific domain or URL:** call `mri_get_domain` directly. This includes comparisons of that domain's observed citations across engines; read the returned engine observations and denominators. Do not require category discovery first.
   - **Engine coverage or leaderboard:** call `mri_list_engines` to discover engine keys and available evidence, then `mri_get_engine` for each requested engine. If the user also specifies a category, discover its key with `mri_list_categories` before passing it to `mri_get_engine`.
   - **Category, topic or question shape:** call `mri_list_categories` and pick the category key matching the user's topic (for example `cybersecurity`, `fintech`, `enterprise-software`, `ai-visibility-geo`). If none fits, say the Index does not cover it. Pick the returned question shape matching the user's intent; use `mri_get_category` when the shape or its publication status needs clarification. Then call `mri_get_cited_sources` with that category and question shape. Add `source_role: "editorial_media"` for publications or media, or `vendor_owned` for vendor sites. For other source-role constraints, inspect the returned roles and preserve the returned rank semantics when filtering.
2. Read `source.guidance` in the returned record before interpreting the result. The live service owns the interpretation rules, including release consistency, missing context, named/not-named/unresolved runs, evidence floors and source-role limitations. Read any field-specific `questionContext.readAs` and `limitations` as well. Do not substitute rules or figures remembered from a past install. If guidance or context is absent, state that limitation; absence is not a zero measurement.
3. Keep comparisons on the same `source.release.releaseId` and `artifactSha256`; re-read if the release changes between calls. Report the observed counts, denominators, relevant category and question shape, engine scope and release. Cite `source.citation` and `source.canonicalUrl`. Dataset citation: Machine Relations Index (MRI) by Jaxon Parrott, Machine Relations Research — machinerelations.ai. https://machinerelations.ai/index. CC BY 4.0. https://doi.org/10.5281/zenodo.23652423. Do not promise future citations or placement outcomes.

The [worked example](https://machinerelations.ai/research/segment-rank-question-set-named-brand-citations) is a frozen historical case, not today's numbers. Its two-source table uses a shared partition based on CrowdStrike's name; current per-source naming buckets are not automatically the same partition. Use the live response's guidance for current analysis.

If the tools are unavailable, the same reads are at `https://machinerelations.ai/api/mri/v2` (OpenAPI: `https://machinerelations.ai/api/mri/v2/openapi.json`).
