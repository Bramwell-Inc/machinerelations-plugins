// Publishes one reviewed version once, everywhere: Zenodo (permanent DOI),
// the GitHub release (the source every site reads), then the sites' deploy
// hooks. Safe to rerun: a version already on Zenodo is adopted byte for byte,
// never deposited twice, and a complete GitHub release ends the run.
//
// Env: ZENODO_TOKEN, GH_TOKEN, VERCEL_DEPLOY_HOOKS (newline-separated URLs).
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { build, sha256 } from './build-release.mjs';
import {
  AUTHOR, COMMIT_FILE, LIBRARY_FILE, LIBRARY_TITLE, PACKAGE_FILE, PUBLISHER, REPO, SUMS_FILE,
  readRelease, releaseTag,
} from './library.mjs';

const ZENODO = process.env.ZENODO_API ?? 'https://zenodo.org/api';
export const CONCEPT_MARKER = 'machinerelations-skills-library';
const secrets = () => [process.env.ZENODO_TOKEN, process.env.GH_TOKEN, ...(process.env.VERCEL_DEPLOY_HOOKS ?? '').split('\n')].filter((s) => s && s.length > 8);
const redact = (text) => secrets().reduce((out, s) => out.split(s).join('[redacted]'), String(text));
const log = (message) => console.log(`release: ${redact(message)}`);

async function request(url, init = {}, timeoutMs = 60_000) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${init.method ?? 'GET'} ${redact(url)} failed (${response.status}): ${redact((await response.text()).slice(0, 1500))}`);
  return response;
}

const zenodoHeaders = (json = false) => ({
  Authorization: `Bearer ${process.env.ZENODO_TOKEN}`,
  Accept: 'application/json',
  'User-Agent': 'machinerelations-skills-release',
  ...(json ? { 'Content-Type': 'application/json' } : {}),
});

async function zenodoJson(path, init = {}) {
  const url = path.startsWith('http') ? path : `${ZENODO}${path}`;
  return (await request(url, { ...init, headers: zenodoHeaders(Boolean(init.body)) })).json();
}

function nextLink(header) {
  for (const part of (header ?? '').split(',')) if (/rel="next"/.test(part)) return /<([^>]+)>/.exec(part)?.[1] ?? null;
  return null;
}

/** Every deposition the token owns, by owner list, not by search. */
async function ownedDepositions() {
  const byId = new Map();
  for (const status of ['published', 'draft']) {
    let url = `${ZENODO}/deposit/depositions?status=${status}&size=50`;
    while (url) {
      const response = await request(url, { headers: zenodoHeaders() });
      const payload = await response.json();
      for (const deposit of Array.isArray(payload) ? payload : payload.hits?.hits ?? []) {
        if (byId.get(String(deposit.id))?.listStatus === 'published') continue;
        byId.set(String(deposit.id), { ...deposit, listStatus: status });
      }
      url = nextLink(response.headers.get('link'));
      if (byId.size > 1000) throw new Error('Zenodo deposition list did not end');
    }
  }
  return [...byId.values()];
}

const isOurs = (deposit) => Array.isArray(deposit.metadata?.keywords) && deposit.metadata.keywords.includes(CONCEPT_MARKER);

/** What Zenodo already holds for this library, and what to do about this version. */
export function planZenodo(deposits, version) {
  const ours = deposits.filter(isOurs);
  const concepts = [...new Set(ours.map((d) => String(d.conceptrecid ?? '')))];
  if (concepts.includes('')) throw new Error('A library deposit has no concept record id');
  if (concepts.length > 1) throw new Error(`More than one Zenodo concept carries ${CONCEPT_MARKER}: ${concepts.join(', ')}`);
  const published = ours.filter((d) => d.listStatus === 'published');
  const done = published.filter((d) => d.metadata?.version === version);
  if (done.length > 1) throw new Error(`Version ${version} is on Zenodo more than once`);
  if (done.length) return { action: 'adopt', deposit: done[0] };
  const drafts = ours.filter((d) => d.listStatus === 'draft');
  if (drafts.length > 1) throw new Error('More than one open library draft on Zenodo');
  if (drafts.length) return { action: 'reuse-draft', deposit: drafts[0] };
  if (published.length) {
    const latest = published.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
    return { action: 'new-version', deposit: latest };
  }
  return { action: 'create' };
}

const escape = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function zenodoMetadata(release, commit) {
  const { version, latest } = release;
  const tagUrl = `https://github.com/${REPO}/tree/${releaseTag(version)}`;
  return {
    upload_type: 'software',
    title: LIBRARY_TITLE,
    version,
    publication_date: latest.date,
    creators: [{ name: `${AUTHOR.family}, ${AUTHOR.given}`, orcid: AUTHOR.orcid, affiliation: PUBLISHER.name }],
    description: [
      `<p>Versioned agent skills for Machine Relations, the discipline of earning AI citations and recommendations for a brand by making that brand legible, retrievable and credible inside AI-driven discovery. Coined by ${escape(AUTHOR.name)} in 2024. Published by ${escape(PUBLISHER.name)}.</p>`,
      `<p>${escape(latest.notes)}</p>`,
      `<p>Skills: ${release.skills.map((s) => `<code>${escape(s.slug)}</code>`).join(', ')}. Source: <a href="${tagUrl}">${escape(REPO)} ${releaseTag(version)}</a> (commit <code>${escape(commit)}</code>). library.json lists every file with its sha256; SHA256SUMS covers them all.</p>`,
    ].join(''),
    license: 'mit',
    access_right: 'open',
    language: 'eng',
    keywords: ['Machine Relations', 'agent skills', 'AI visibility', 'generative engine optimization', 'digital PR', CONCEPT_MARKER],
    notes: `${CONCEPT_MARKER} ${version}`,
    related_identifiers: [
      { identifier: tagUrl, relation: 'isSupplementTo', scheme: 'url', resource_type: 'software' },
      { identifier: 'https://machinerelations.ai/skill', relation: 'isDocumentedBy', scheme: 'url', resource_type: 'publication' },
      { identifier: '10.5281/zenodo.23652423', relation: 'references', scheme: 'doi', resource_type: 'dataset' },
    ],
    prereserve_doi: true,
  };
}

async function openDraft(plan, metadata) {
  if (plan.action === 'create') return zenodoJson('/deposit/depositions', { method: 'POST', body: JSON.stringify({ metadata }) });
  if (plan.action === 'reuse-draft') return zenodoJson(`/deposit/depositions/${plan.deposit.id}`);
  const opened = await zenodoJson(`/deposit/depositions/${plan.deposit.id}/actions/newversion`, { method: 'POST' });
  if (!opened.links?.latest_draft) throw new Error('Zenodo newversion returned no latest_draft');
  return zenodoJson(opened.links.latest_draft);
}

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');

/** Deposit dist/ on Zenodo with reserved DOIs written into library.json first. */
async function deposit(plan, release, commit, dist) {
  const metadata = zenodoMetadata(release, commit);
  let draft = await openDraft(plan, metadata);
  draft = await zenodoJson(`/deposit/depositions/${draft.id}`, { method: 'PUT', body: JSON.stringify({ metadata }) });
  const versionDoi = draft.metadata?.prereserve_doi?.doi;
  const conceptRecid = String(draft.conceptrecid ?? '');
  if (!/^10\.5281\/zenodo\.\d+$/.test(versionDoi ?? '') || !/^\d+$/.test(conceptRecid)) {
    throw new Error(`Zenodo draft ${draft.id} reserved no DOI (doi ${versionDoi}, concept ${conceptRecid})`);
  }
  const conceptDoi = `10.5281/zenodo.${conceptRecid}`;
  log(`draft ${draft.id}: version DOI ${versionDoi}, concept DOI ${conceptDoi}`);
  const library = build({ dist, doi: { concept: conceptDoi, version: versionDoi } });

  for (const file of draft.files ?? []) {
    if (file.links?.self) await request(file.links.self, { method: 'DELETE', headers: zenodoHeaders() });
  }
  const bucket = draft.links?.bucket;
  if (!bucket) throw new Error(`Zenodo draft ${draft.id} has no bucket`);
  for (const name of readdirSync(dist).sort()) {
    const bytes = readFileSync(resolve(dist, name));
    const stored = await (await request(`${bucket}/${encodeURIComponent(name)}`, { method: 'PUT', headers: zenodoHeaders(), body: bytes }, 180_000)).json();
    if (stored.checksum !== `md5:${md5(bytes)}`) throw new Error(`Zenodo stored ${name} with checksum ${stored.checksum}`);
  }
  const published = await zenodoJson(`/deposit/depositions/${draft.id}/actions/publish`, { method: 'POST' });
  if (published.doi !== versionDoi || String(published.conceptrecid) !== conceptRecid) {
    throw new Error(`Zenodo published ${published.doi} (concept ${published.conceptrecid}), expected ${versionDoi} (${conceptRecid})`);
  }
  log(`published Zenodo record ${published.id}: https://doi.org/${versionDoi}`);
  return library;
}

/** Replace dist/ with the exact files of the version already on Zenodo. */
async function adopt(depositRecord, dist) {
  const record = await zenodoJson(`/deposit/depositions/${depositRecord.id}`);
  for (const name of readdirSync(dist)) unlinkSync(resolve(dist, name));
  for (const file of record.files ?? []) {
    const bytes = Buffer.from(await (await request(file.links.download, { headers: zenodoHeaders() }, 180_000)).arrayBuffer());
    if (md5(bytes) !== file.checksum.replace(/^md5:/, '')) throw new Error(`Downloaded ${file.filename} does not match Zenodo's checksum`);
    writeFileSync(resolve(dist, file.filename), bytes);
  }
  const library = JSON.parse(readFileSync(resolve(dist, LIBRARY_FILE), 'utf8'));
  if (library.doi.version !== record.doi) throw new Error(`Adopted library.json names ${library.doi.version}, record is ${record.doi}`);
  log(`adopted Zenodo record ${record.id} (${record.doi}) byte for byte`);
  return library;
}

/** Every file named in library.json and SHA256SUMS is present with that digest. */
export function verifyDist(dist, version) {
  const library = JSON.parse(readFileSync(resolve(dist, LIBRARY_FILE), 'utf8'));
  if (library.version !== version) throw new Error(`library.json is ${library.version}, expected ${version}`);
  if (!library.doi.version || !library.doi.concept) throw new Error('library.json has no DOI');
  for (const entry of [library.package, ...library.skills.map((s) => s.archive)]) {
    if (sha256(readFileSync(resolve(dist, entry.file))) !== entry.sha256) throw new Error(`${entry.file} does not match library.json`);
  }
  for (const line of readFileSync(resolve(dist, SUMS_FILE), 'utf8').trim().split('\n')) {
    const [digest, name] = line.split(/\s+/);
    if (sha256(readFileSync(resolve(dist, name))) !== digest) throw new Error(`${name} does not match SHA256SUMS`);
  }
  return library;
}

const gh = (args, opts = {}) => execFileSync('gh', args, { encoding: 'utf8', ...opts });

function githubRelease(tag) {
  try {
    return JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'assets,isDraft'], { stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    if (/release not found/i.test(String(error.stderr))) return null;
    throw error;
  }
}

export function releaseNotes(library, dist) {
  const sums = readFileSync(resolve(dist, SUMS_FILE), 'utf8').trim();
  return [
    library.notes,
    '',
    `Cite this version: ${library.citation}`,
    `All versions: ${library.doi.concept_url}`,
    '',
    `Built and tested from commit ${library.source.commit} by the Validate and package workflow; Zenodo holds the identical files.`,
    '',
    '```',
    sums,
    '```',
    '',
    'Directory listings (Claude, ChatGPT) update through their own review and may show an earlier version.',
  ].join('\n');
}

async function callDeployHooks() {
  const hooks = (process.env.VERCEL_DEPLOY_HOOKS ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!hooks.length) throw new Error('No deploy hooks configured; the sites will not rebuild from this release');
  for (const hook of hooks) {
    const response = await request(hook, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    log(`deploy hook accepted: ${body.job?.id ?? response.status}`);
  }
}

export async function publish({ dist }) {
  const release = readRelease();
  const tag = releaseTag(release.version);
  const existing = githubRelease(tag);
  if (existing && !existing.isDraft) {
    if (existing.assets?.some((a) => a.name === LIBRARY_FILE)) return log(`${tag} is already released; nothing to do`);
    // Releases are immutable once published: one without library.json can't be repaired in place.
    throw new Error(`${tag} was published without ${LIBRARY_FILE}; release the next patch version`);
  }
  if (!process.env.ZENODO_TOKEN) throw new Error('ZENODO_TOKEN is not set');
  const plan = planZenodo(await ownedDepositions(), release.version);
  log(`Zenodo plan for ${release.version}: ${plan.action}${plan.deposit ? ` (${plan.deposit.id})` : ''}`);
  const commit = readFileSync(resolve(dist, COMMIT_FILE), 'utf8').trim();
  if (plan.action === 'adopt') await adopt(plan.deposit, dist);
  else await deposit(plan, release, commit, dist);
  const library = verifyDist(dist, release.version);

  const notes = resolve(dist, '..', 'release-notes.md');
  writeFileSync(notes, releaseNotes(library, dist));
  const files = readdirSync(dist).sort().map((name) => resolve(dist, name));
  gh(['release', 'create', tag, ...files, '--repo', REPO, '--target', library.source.commit, '--title', `${LIBRARY_TITLE} ${release.version}`, '--notes-file', notes, '--latest']);
  log(`GitHub release ${tag} carries ${files.length} files`);
  await callDeployHooks();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { dist: { type: 'string', default: 'dist' } } });
  publish({ dist: resolve(values.dist) }).catch((error) => {
    console.error(redact(error.stack ?? error));
    process.exit(1);
  });
}
