#!/usr/bin/env node
// Finds what to check for this commit, with nothing configured per site and no stored secret:
// the Vercel preview of this exact commit, read from the GitHub Deployment that Vercel's Git integration
// records on the repo, and the production domain to compare against, read from the preview's own sitemap.
// Writes GitHub step outputs: skip, url, base. A repo Vercel never deploys is not a site and passes untouched.
import fs from 'node:fs';
import { previewAccess } from './access.mjs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, SHA, GITHUB_OUTPUT } = process.env;
const out = (k, v) => { if (GITHUB_OUTPUT) fs.appendFileSync(GITHUB_OUTPUT, `${k}=${v}\n`); console.log(`${k}=${v}`); };
const gh = async (path) => {
  const r = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, { headers: { authorization: `Bearer ${GITHUB_TOKEN}`, accept: 'application/vnd.github+json' } });
  if (!r.ok) throw new Error(`GET ${path.split('?')[0]} answered ${r.status}`);
  return r.json();
};
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const isPreview = (d) => /preview/i.test(d.environment || '') || d.transient_environment;

// A repo Vercel has never deployed is not a site: nothing to check.
const any = await gh('/deployments?per_page=100');
if (!any.some((d) => d.creator?.login?.startsWith('vercel'))) { console.log(`page-check: Vercel has never deployed ${GITHUB_REPOSITORY}, so it is not a site; nothing to check`); out('skip', 'not-a-site'); process.exit(0); }

// The preview of this exact commit. Vercel starts it on push; wait until it reports.
let url = ''; let last = 'missing'; const until = Date.now() + 25 * 60 * 1000;
while (Date.now() < until && !url) {
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
if (!url) { console.log(`page-check: Vercel preview of ${SHA.slice(0, 7)} is ${last}; the build check reports that, not this one`); out('skip', `deployment-${last}`); process.exit(0); }

// Past preview protection with the run's own identity. If the preview still answers 401/403, this org's
// GitHub Actions is not yet a Trusted Source on the Vercel project: say so loudly and pass, never block on it.
{
  const access = previewAccess({ previewUrl: url });
  const r = await fetch(url + '/', { headers: await access.forUrl(url + '/'), redirect: 'manual', signal: AbortSignal.timeout(20000) }).catch(() => null);
  if (r && [401, 403].includes(r.status)) {
    console.log(`::warning::page-check: the preview is protected and refused this run (${r.status}). Add GitHub Actions of this org as a Trusted Source for previews on the Vercel project (Settings, Deployment Protection).`);
    out('skip', 'preview-protected'); process.exit(0);
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
if (!base) { console.log('::warning::page-check: could not tell this site\'s production domain (no sitemap host, no repo homepage), so it did not judge this change. Set the repo homepage to the site address.'); out('skip', 'no-production'); process.exit(0); }

out('skip', '');
out('url', url);
out('base', base);
