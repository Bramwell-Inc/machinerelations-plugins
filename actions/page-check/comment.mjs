#!/usr/bin/env node
// One comment per pull request, edited in place, for every run: clean, blocking, or not judged.
import fs from 'node:fs';
import { planFromDir } from './outcome.mjs';

const OUT = process.argv[2] || 'page-check-report';
const MARK = '<!-- machine-relations-page-check -->';
const { GH_TOKEN, GITHUB_REPOSITORY, PR, GITHUB_STEP_SUMMARY } = process.env;
const plan = planFromDir(OUT);
const text = `${MARK}\n${plan.body}`;
if (GITHUB_STEP_SUMMARY) fs.appendFileSync(GITHUB_STEP_SUMMARY, `${plan.body}\n`);
console.log(`page-check: ${plan.verdict}`);

if (!GH_TOKEN || !GITHUB_REPOSITORY || !PR) {
  console.log(plan.body);
  process.exit(0);
}

const api = async (p, init = {}) => {
  const r = await fetch(`https://api.github.com${p}`, {
    ...init,
    headers: {
      authorization: `Bearer ${GH_TOKEN}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
  });
  if (!r.ok) throw new Error(`${init.method || 'GET'} ${p} answered ${r.status}`);
  return r.status === 204 ? null : r.json();
};

try {
  const comments = await api(`/repos/${GITHUB_REPOSITORY}/issues/${PR}/comments?per_page=100`);
  const mine = comments.find((c) => c.body?.startsWith(MARK));
  if (mine) await api(`/repos/${GITHUB_REPOSITORY}/issues/comments/${mine.id}`, { method: 'PATCH', body: JSON.stringify({ body: text }) });
  else await api(`/repos/${GITHUB_REPOSITORY}/issues/${PR}/comments`, { method: 'POST', body: JSON.stringify({ body: text }) });
} catch (error) {
  console.log(`::warning::Page check could not post its comment (${error.message}). The result is in the job summary.`);
}
