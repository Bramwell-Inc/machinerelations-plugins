#!/usr/bin/env node
// Finds what to check for this commit, with nothing configured per site and no stored secret:
// the Vercel preview of this commit. A GitHub deployment record pins it. When that list is empty, a
// commit status from the Vercel GitHub app still means the project is linked. Its inspector URL
// plus the pull request branch is the branch preview: the latest preview of the branch, not this
// commit. The OIDC token is sent only to that derived HTTPS host. A clean or blocking verdict
// waits until the response carries this commit or that deployment id.
// The production domain is read from the preview's own sitemap.
// Writes GitHub step outputs: skip, url, base. No Vercel record and no authentic Vercel status is not a site.
// A green job with a skip did not render pages.
import fs from 'node:fs';
import { previewAccess } from './access.mjs';
import { hasVercelDeployment, protectionStatus, resolveStatusPreview, responseProvesDeployment } from './discover.mjs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, SHA, GITHUB_OUTPUT } = process.env;
const out = (k, v) => { if (GITHUB_OUTPUT) fs.appendFileSync(GITHUB_OUTPUT, `${k}=${v}\n`); console.log(`${k}=${v}`); };
const gh = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GET ${path.split('?')[0]} answered ${r.status}`);
  return r.json();
};
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const isPreview = (d) => /preview/i.test(d.environment || '') || d.transient_environment;

// GitHub deployment records are the pinned preview. An empty list is not, by itself, proof
// that Vercel has never deployed the repo: some linked projects only post a commit status.
const any = await gh('/deployments?per_page=100');
let url = '';
let alias = false;
let deploymentId = '';
if (!hasVercelDeployment(any)) {
  const decision = await resolveStatusPreview({
    readStatuses: async () => {
      const body = await gh(`/commits/${SHA}/statuses?per_page=100`);
      return Array.isArray(body) ? body : (body.statuses || []);
    },
    branch: process.env.GITHUB_HEAD_REF || '',
    sleep: wait,
    now: () => Date.now(),
    deadline: Date.now() + 25 * 60 * 1000,
  });
  if (decision.action === 'not-a-site') {
    console.log(`page-check: not judged. No Vercel deployment record and no commit status from the Vercel GitHub app for ${GITHUB_REPOSITORY}. This is not treated as a site. A green job did not render pages.`);
    out('skip', 'not-a-site');
    process.exit(0);
  }
  if (decision.action === 'finished') {
    console.log(`page-check: not judged. Vercel status for ${SHA.slice(0, 7)} is ${decision.state}, and GitHub has no deployment record. A green job did not render pages.`);
    out('skip', `deployment-${decision.state || 'missing'}`);
    process.exit(0);
  }
  if (decision.action !== 'use') {
    console.log(`page-check: not judged. Vercel completed a deployment of ${SHA.slice(0, 7)}, but there is no single HTTPS preview bound to that status (${decision.limit}). A green job did not render pages.`);
    out('skip', 'no-preview-url');
    process.exit(0);
  }
  url = decision.url;
  alias = decision.limit === 'branch-alias';
  deploymentId = decision.deploymentId || '';
  if (alias) console.log(`page-check: GitHub has no deployment record for ${GITHUB_REPOSITORY}. The Vercel app's status names inspector deployment ${deploymentId}. The host ${url} is the latest preview of this branch, not ${SHA.slice(0, 7)}, until the response proves that deployment.`);
}

// The preview of this exact commit, when a deployment record exists. Vercel starts it on push; wait until it reports.
let last = 'missing'; const until = Date.now() + 25 * 60 * 1000;
while (!url && Date.now() < until) {
  const deps = (await gh(`/deployments?sha=${SHA}&per_page=20`)).filter((d) => d.creator?.login?.startsWith('vercel') && isPreview(d));
  for (const d of deps) {
    const [s] = await gh(`/deployments/${d.id}/statuses?per_page=1`);
    if (!s) continue;
    last = s.state;
    if (s.state === 'success' && s.environment_url) { url = s.environment_url.replace(/\/$/, ''); break; }
  }
  if (!url && ['failure', 'error', 'inactive'].includes(last)) break;
  if (!url) await wait(20000);
}
if (!url) { console.log(`page-check: not judged. Vercel preview of ${SHA.slice(0, 7)} is ${last}; the build check reports that.`); out('skip', `deployment-${last}`); process.exit(0); }

// Past preview protection with the run's own identity. If the preview still answers 401/403, this org's
// GitHub Actions is not yet a Trusted Source on the Vercel project: say so loudly and pass, never block on it.
{
  const access = previewAccess({ previewUrl: url });
  const r = await fetch(url + '/', { headers: await access.forUrl(url + '/'), redirect: 'manual', signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (alias && r && r.status === 404) {
    console.log(`::warning::page-check: not judged. The branch preview ${url} did not answer. A green job did not render pages.`);
    out('skip', 'preview-alias-missing');
    process.exit(0);
  }
  if (r && protectionStatus(r.status, r.headers.get('location'))) {
    console.log(`::warning::page-check: not judged. The preview refused this run (${r.status}). Trusted preview access is a setting on this Vercel project for GitHub Actions of this org (Settings, Deployment Protection).`);
    out('detail', String(r.status));
    out('skip', 'preview-protected'); process.exit(0);
  }
  if (alias) {
    const headers = [];
    if (r) r.headers.forEach((value, key) => headers.push([key, value]));
    const body = r && r.status >= 200 && r.status < 300 ? await r.text() : '';
    if (!responseProvesDeployment({ headers, body, sha: SHA, deploymentId })) {
      console.log(`::warning::page-check: not judged. ${url} is the latest preview of this branch, and the response did not contain ${SHA.slice(0, 7)} or deployment ${deploymentId}. No clean or blocking verdict was given.`);
      out('skip', 'preview-head-unverified');
      process.exit(0);
    }
  }
}

// Production to compare with: the host the site's own sitemap names (sites list their canonical domain there).
let base = '';
try {
  const access = previewAccess({ previewUrl: url });
  for (const p of ['/sitemap.xml', '/sitemap_index.xml', '/sitemap-index.xml']) {
    const r = await fetch(url + p, { headers: await access.forUrl(url + p), signal: AbortSignal.timeout(20000) });
    if (!r.ok) continue;
    const loc = ((await r.text()).match(/<loc>\s*([^<\s]+)/) || [])[1];
    if (loc) { const h = new URL(loc); if (!h.host.endsWith('.vercel.app')) base = `${h.protocol}//${h.host}`; break; }
  }
} catch (e) { console.log(`page-check: could not read the preview sitemap for a production domain (${e.message})`); }
if (!base) { const { homepage } = await gh(''); if (homepage && /^https?:\/\//.test(homepage) && !/vercel\.app/.test(homepage)) base = homepage.replace(/\/$/, ''); }

// Without production to compare with, every old flaw would look new and block: pass, loudly, instead.
if (!base) { console.log('::warning::page-check: not judged. Could not tell this site\'s production domain (no sitemap host, no repo homepage). Set the repo homepage to the site address.'); out('skip', 'no-production'); process.exit(0); }

out('skip', '');
out('url', url);
out('base', base);
