# Changelog

Every released version of the Machine Relations skills and plugin. The newest entry's text is the release note for the GitHub release, the Zenodo record and the directory listings, so it is written for practitioners. Versions follow semver: a minor version adds or graduates a method, a patch corrects wording or metadata, and a major version changes a tool or endpoint.

## [1.2.3] - 2026-11-06

The Page check names three results on the pull request. Clean means the sampled pages were read and this change adds nothing that blocks. Blocking means it does, and the check fails. Not judged means the pages were not read: the preview refused this run, the preview did not build, production could not be identified, the repository is not a site, or the checker did not finish. The job still passes when the pages were not read, so a broken check does not stop every merge. A push straight to the default branch is still unchecked. Sampling is still the site's own sitemap rather than every template.

## [1.2.2] - 2026-11-06

Stop the Page check flagging what is set small or coded on purpose: footnote marks, short capitalised labels such as kickers, table heads and datelines, and bare numbers such as steps and counts no longer count as small text, and an error code written after its HTTP status ("returns 409 release_unavailable") no longer counts as a leaked value. Running text at 10px and raw values printed in prose are still flagged. Text contrast is now measured on every page in light and dark, including text above the dot-grid and other gradient backgrounds that the accessibility engine skipped, and each failing colour pair is reported once. A share image on another host, such as a storage bucket, is fetched where it is instead of on the site being checked. Skills, MRI tools and endpoints are unchanged.

## [1.2.1] - 2026-11-06

Keep the Page check skill free of credentials: the installed skill reads only public pages, and the GitHub Action that checks protected previews and comments on pull requests moves out of the plugin into the repository's actions folder. Skills, MRI tools and endpoints are unchanged.

## [1.2.0] - 2026-11-06

Add the Page check skill: render a site from its own sitemap at phone, tablet and desktop widths in light and dark, and report broken layout, unreadable text, raw values printed to readers, broken links and images, and gaps in what AI engines read. The same code runs as a GitHub Action an organization can require on every pull request. MRI tools, endpoints and the existing skills are unchanged.

## [1.1.6] - 2026-11-02

Describe all six read-only MRI tools and route research by intent: look up domains directly, discover engines for engine leaderboards, and discover categories and question shapes for topic research. Live interpretation guidance, measurement and endpoints are unchanged.

## [1.1.5] - 2026-10-29

Name Machine Relations Research as publisher by its permanent identifier, link the library to its Wikidata item and to both of its pages, and add a citation by the DOI that covers all versions, which the sites now show first. Skills, tools and endpoints are unchanged.

## [1.1.4] - 2026-10-28

Credit Jaxon Parrott as the author of the Machine Relations skills and give every skill the package version. Each release now carries its own permanent DOI, checksums and a machine-readable library manifest; tools, endpoints and skill behaviour are unchanged.

## [1.1.3] - 2026-10-26

Attribute the Index as Machine Relations Index (MRI) by Jaxon Parrott and cite the Zenodo concept DOI; tools, endpoints and behaviour unchanged.

## [1.1.2] - 2026-10-26

Name AuthorityTech exactly The World's First Machine Relations Agency in the README and skill; tools, endpoints and behaviour unchanged.

## [1.1.1] - 2026-10-22

State the full origin chain: Jaxon Parrott coined Machine Relations in 2024; AuthorityTech, which he founded in 2018, is The World's First Machine Relations Agency; Machine Relations is open to anyone and machinerelations.ai is its home. Name Machine Relations Research as the Index publisher.

## [1.1.0] - 2026-10-22

Add the Machine Relations skill beside the Machine Relations Index research skill: turn a brand objective and permitted evidence into an authority intervention brief, a usable pitch or work draft, and separate execution and outcome checks.

## [1.0.4] - 2026-10-18

Include the documentation, support links and license in the installed plugin package.

## [1.0.3] - 2026-10-04

Read interpretation guidance from live MRI responses and link the historical worked example, so daily data releases and interpretation corrections need no plugin edits.

## [1.0.1] - 2026-10-02

Prepare the plugin for directory review: icon, privacy policy and review metadata.

## [1.0.0] - 2026-10-02

First release: the Machine Relations Index plugin for Codex, ChatGPT and Claude Code, with read-only MRI research tools.
