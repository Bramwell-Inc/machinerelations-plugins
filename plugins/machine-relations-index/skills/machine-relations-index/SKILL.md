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
5. Report what the data says:
   - Citation rate as a percentage of monitored answer runs, with the domain's rank out of the segment total.
   - Never infer per-engine rates from pooled rates, promise future citations, or claim that coverage causes citations. Preserve returned rank semantics when filtering sources.
   - The segment (category and question shape) and the release window from `source.release`.
   - If `status` is `collecting`, say rates are not yet published and do not present the order as a ranking.
   - If a domain is not found, say it was not observed in this release, not that it is never cited.
6. Cite the source with the response's `source.citation` and `source.canonicalUrl` (data is CC BY 4.0).

If the tools are unavailable, the same reads are at `https://machinerelations.ai/api/mri/v2` (OpenAPI: `https://machinerelations.ai/api/mri/v2/openapi.json`).
