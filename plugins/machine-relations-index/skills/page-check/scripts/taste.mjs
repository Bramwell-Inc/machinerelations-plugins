#!/usr/bin/env node
// Taste notes: Claude looks at the screenshots against the site's own design intent. Never blocks.
// Needs ANTHROPIC_API_KEY. Reads the asset's design layer from DESIGN_LAYER (text) when the caller supplies it.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'page-check-report';
const key = process.env.ANTHROPIC_API_KEY;
if (!key) { console.log('taste: no ANTHROPIC_API_KEY, skipping taste notes'); process.exit(0); }
const report = JSON.parse(fs.readFileSync(path.join(OUT, 'report.json'), 'utf8'));
const shots = fs.readdirSync(path.join(OUT, 'shots')).filter((f) => /--(phone|wide)\.png$/.test(f)).slice(0, 12);
const layer = process.env.DESIGN_LAYER || '';
const content = [
  { type: 'text', text: `You are reviewing a pull request preview of ${report.url} before it merges. ${layer ? `The site's own design intent:\n${layer}\n\n` : ''}Each image is one page type at phone (390) or wide (1440). Judge the whole as a stranger would: does each page show in one second what matters and what to do; hierarchy, proportion, rhythm, alignment, spacing, and anything that looks broken, cramped, empty or unfinished. Measurable defects (overflow, overlap, tiny text) are already checked; do not repeat them. Give at most five notes, most important first, each one line naming the page and the fix. If nothing is worth changing, say "Nothing to change." Plain words, no preamble.` },
];
for (const f of shots) {
  content.push({ type: 'text', text: f.replace('.png', '') });
  content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: fs.readFileSync(path.join(OUT, 'shots', f)).toString('base64') } });
}
const r = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
  body: JSON.stringify({ model: process.env.TASTE_MODEL || 'claude-sonnet-5-5', max_tokens: 800, messages: [{ role: 'user', content }] }),
});
if (!r.ok) { console.log(`taste: model answered ${r.status}; no taste notes this run`); process.exit(0); }
const text = (await r.json()).content?.map((c) => c.text || '').join('').trim();
if (text) fs.appendFileSync(path.join(OUT, 'summary.md'), `\n<details open><summary>Taste notes (never blocking)</summary>\n\n${text}\n\n</details>\n`);
console.log(text);
