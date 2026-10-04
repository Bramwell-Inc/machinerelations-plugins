---
name: machine-relations-index
description: Use when asked which sources or publications AI answer engines cite for a topic or category, where coverage gets cited by AI, or how often a given site is cited. Answers from the Machine Relations Index tools with measured rates and a citation.
---

# Machine Relations Index

The Machine Relations Index (MRI) measures which source domains AI answer engines cite when buyers ask questions, per category and buyer question shape. Answer from its tools; do not estimate citation behavior from memory.

1. Map the topic to a category. Call `mri_list_categories` and pick the category key that matches the user's topic (for example `cybersecurity`, `fintech`, `enterprise-software`, `ai-visibility-geo`). If none fits, say the Index does not cover it.
2. Pick the question shape that matches the user's intent: `best_x` (best tools), `how_choose` (how to choose), `x_vs_y` (comparisons), `top_list` (top platforms), `problem_first` (solving a problem), `is_x_worth` (is it worth it), `news_topic` (recent news). If unclear, use `mri_get_category` to see which shapes have published rates and use those.
3. Call `mri_get_cited_sources` with the category and question shape. Add `source_role: "editorial_media"` when the user asks about publications or media, `vendor_owned` for vendor sites.
4. For a specific site, call `mri_get_domain` with its domain or any URL on it.
5. Read `source.guidance` in the returned record before interpreting the result. The live service owns the interpretation rules, including release consistency, missing context, named/not-named/unresolved runs, evidence floors and source-role limitations. Read any field-specific `questionContext.readAs` and `limitations` as well. Do not substitute rules or figures remembered from a past install. If guidance or context is absent, state that limitation; absence is not a zero measurement.
6. Report the observed counts, denominators, category, question shape and release. Cite `source.citation` and `source.canonicalUrl`. Do not promise future citations or placement outcomes.

The [worked example](https://machinerelations.ai/research/segment-rank-question-set-named-brand-citations) is a frozen historical case, not today's numbers. Its two-source table uses a shared partition based on CrowdStrike's name; current per-source naming buckets are not automatically the same partition. Use the live response's guidance for current analysis.

If the tools are unavailable, the same reads are at `https://machinerelations.ai/api/mri/v2` (OpenAPI: `https://machinerelations.ai/api/mri/v2/openapi.json`).
