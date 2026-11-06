#!/usr/bin/env node
// One comment per PR, edited in place. Posted only when there is something to read (a blocker or a taste note);
// when a later push clears everything, the same comment is edited to say so. Never a new comment per push.
import fs from 'node:fs';
import path from 'node:path';

const OUT = process.argv[2] || 'page-check-report';
const { GH_TOKEN, GITHUB_REPOSITORY, PR, CODE } = process.env;
const MARK = '<!-- machine-relations-page-check -->';
const api = async (p, init = {}) => {
  const r = await fetch(`https://api.github.com${p}`, { ...init, headers: { authorization: `Bearer ${GH_TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' } });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} answered ${r.status}`);
  return r.json();
};
const summary = fs.readFileSync(path.join(OUT, 'summary.md'), 'utf8');
const hasTaste = summary.includes('Taste notes') && !/Taste notes[\s\S]*Nothing to change\./.test(summary);
const worth = CODE !== '0' || hasTaste;
const comments = await api(`/repos/${GITHUB_REPOSITORY}/issues/${PR}/comments?per_page=100`);
const mine = comments.find((c) => c.body?.startsWith(MARK));
const body = `${MARK}\n${worth ? summary : '**Page check: clean.** Nothing this change adds blocks, and nothing to note.'}\n\n<sub>[How the page check works](https://github.com/Bramwell-Inc/machinerelations-plugins/tree/main/plugins/machine-relations-index/skills/page-check)</sub>`;
if (mine) await api(`/repos/${GITHUB_REPOSITORY}/issues/comments/${mine.id}`, { method: 'PATCH', body: JSON.stringify({ body }) });
else if (worth) await api(`/repos/${GITHUB_REPOSITORY}/issues/${PR}/comments`, { method: 'POST', body: JSON.stringify({ body }) });
console.log(worth ? 'page-check: comment posted' : 'page-check: clean, no comment');
