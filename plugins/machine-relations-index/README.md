# Machine Relations Index

Explore which source domains AI answer engines cite for a buyer category and question type, or look up a domain’s observed citations. The plugin connects to the free, read-only Machine Relations Index MCP server at `https://machinerelations.ai/mcp`; no MRI account or API key is required.

Ask “Which editorial publications are cited for best cybersecurity tools?” or “Look up techcrunch.com in the Machine Relations Index.” The accompanying skill reads the service’s live interpretation guidance, release identity and limitations. Results describe measured citations, not endorsements or guarantees of future visibility. The [worked example](https://machinerelations.ai/research/segment-rank-question-set-named-brand-citations) is a historical case study, not the current leaderboard.

## Data handling

Tool arguments are sent over HTTPS to the declared Machine Relations Index server. The plugin has no additional service destination and no local commands or hooks. Do not include private conversations, credentials or personal information in queries. See the service’s privacy policy for processing and operational logging details.

## Documentation and support

- [Index and installation](https://machinerelations.ai/index#use-with-ai-agents)
- [API and MCP documentation](https://machinerelations.ai/developers)
- [Support](https://machinerelations.ai/contact): support@machinerelations.ai
- [Privacy policy](https://machinerelations.ai/privacy)
- [Terms of use](https://machinerelations.ai/terms)

The plugin code is MIT licensed. MRI data is licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); preserve the citation returned with the results.
