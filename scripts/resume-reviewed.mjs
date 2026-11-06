// Publish the already reviewed 1.2.3 artifact onto draft 24020018.
// It does not rebuild the files from HEAD, does not call newversion, and does
// not delete a deposition or a file. Inherited files stay on the one-file
// delete job. This uploads only when a fresh read shows no files, or publishes
// when the files already match the artifact byte for byte.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sha256 } from './build-release.mjs';
import { COMMIT_FILE, CONCEPT_DOI, LIBRARY_FILE, LIBRARY_TITLE, REPO, readRelease } from './library.mjs';
import { releaseNotes, verifyDist, waitForLatest, zenodoMetadata } from './publish-release.mjs';
import { assessDraft } from './zenodo-draft.mjs';

export const REVIEWED_COMMIT = '9a3357ab787e9f54559474c2f943e775be1e5675';
export const REVIEWED_VERSION = '1.2.3';
export const REVIEWED_DRAFT = '24020018';
export const REVIEWED_CONCEPT = '23749768';
export const REVIEWED_DOI = '10.5281/zenodo.24020018';
export const REVIEWED_RUN = '42274178672';
export const REVIEWED_ARTIFACT = 'machine-relations-index-1.2.3-9a3357a';

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const digestOf = (checksum) => String(checksum ?? '').replace(/^md5:/, '');

export function reviewedExpect() {
  if (CONCEPT_DOI !== `10.5281/zenodo.${REVIEWED_CONCEPT}`) {
    throw new Error(`checkout concept ${CONCEPT_DOI} is not the reviewed concept`);
  }
  return { draftId: REVIEWED_DRAFT, version: REVIEWED_VERSION, concept: REVIEWED_CONCEPT, doi: REVIEWED_DOI };
}

export function inspectReviewedDist(dist) {
  const recorded = readFileSync(resolve(dist, COMMIT_FILE), 'utf8').trim();
  if (recorded !== REVIEWED_COMMIT) {
    throw new Error(`SOURCE_COMMIT is ${recorded || 'empty'}, the reviewed commit is ${REVIEWED_COMMIT}`);
  }
  const library = verifyDist(dist, REVIEWED_VERSION);
  if (library.source?.commit !== REVIEWED_COMMIT) throw new Error('library.json cites a different commit');
  if (library.source?.tag !== `v${REVIEWED_VERSION}`) throw new Error('library.json cites a different tag');
  const names = readdirSync(dist).filter((name) => !name.startsWith('.'));
  const files = new Map(names.map((name) => [name, md5(readFileSync(resolve(dist, name)))]));
  return { library, files };
}

function sameFiles(listed, files) {
  if (listed.length !== files.size) return false;
  return listed.every((file) => files.get(file.filename) === digestOf(file.checksum));
}

export function decideResume(draft, files) {
  const expect = reviewedExpect();
  if (draft.submitted === true && draft.metadata?.version === expect.version && (draft.doi === expect.doi || draft.metadata?.prereserve_doi?.doi === expect.doi) && String(draft.conceptrecid) === expect.concept) {
    return { action: 'github-only', mutation: 'not-attempted' };
  }
  const problems = assessDraft(draft, expect);
  if (problems.length) return { action: 'stop', stopped: 'not-validated', problems, mutation: 'not-attempted' };
  const listed = draft.files ?? [];
  if (listed.length === 0) return { action: 'upload', mutation: 'not-attempted' };
  if (sameFiles(listed, files)) return { action: 'publish-existing', mutation: 'not-attempted' };
  return {
    action: 'stop',
    stopped: 'files-remain',
    files: listed.map((file) => file.filename).filter(Boolean).sort(),
    mutation: 'not-attempted',
  };
}

function errorFields(text) {
  try {
    const body = JSON.parse(text);
    return { error_id: typeof body.error_id === 'string' ? body.error_id : null, message: typeof body.message === 'string' ? body.message : null };
  } catch {
    return { error_id: null, message: null };
  }
}

async function call(doFetch, url, init) {
  let response;
  try {
    response = await doFetch(url, {
      method: init.method,
      redirect: 'manual',
      signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      headers: init.headers,
      body: init.body,
    });
  } catch {
    return { status: null, json: null, redirected: false, ...errorFields('') };
  }
  const text = await response.text();
  if (response.status >= 300 && response.status < 400) return { status: response.status, json: null, redirected: true, ...errorFields('') };
  let json = null;
  if (text && response.status !== 204) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: response.status, json, redirected: false, ...errorFields(text) };
}

function headers(token, json) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    'User-Agent': 'machinerelations-skills-release',
    ...(json ? { 'Content-Type': 'application/json' } : {}),
  };
}

function bucketFor(api, draft) {
  const bucket = draft.links?.bucket;
  if (typeof bucket !== 'string' || !bucket.startsWith(`${api}/files/`) || bucket.slice(`${api}/files/`.length).includes('/')) return null;
  return bucket;
}

async function uploadAll(doFetch, api, token, bucket, dist, files) {
  const uploaded = [];
  for (const name of [...files.keys()].sort()) {
    if (name.includes('/') || name.includes('..')) return { ok: false, stopped: 'bad-filename', mutation: 'unknown', uploaded };
    const bytes = readFileSync(resolve(dist, name));
    const stored = await call(doFetch, `${bucket}/${encodeURIComponent(name)}`, {
      method: 'PUT', timeoutMs: 180_000, headers: headers(token, false), body: bytes,
    });
    if (stored.redirected || stored.status === null || stored.status === 500) {
      return { ok: false, stopped: stored.status === 500 ? 'zenodo-500' : 'uncertain', request: 'PUT', status: stored.status, mutation: 'unknown', uploaded, error_id: stored.error_id, message: stored.message };
    }
    if (stored.status !== 200 && stored.status !== 201) {
      return { ok: false, stopped: 'uncertain', request: 'PUT', status: stored.status, mutation: 'unknown', uploaded };
    }
    if (stored.json?.checksum !== `md5:${md5(bytes)}`) {
      return { ok: false, stopped: 'checksum', request: 'PUT', mutation: 'unknown', uploaded };
    }
    uploaded.push(name);
  }
  return { ok: true, uploaded };
}

function githubRelease({ library, dist, gh }) {
  const tag = `v${library.version}`;
  let existing = null;
  try {
    existing = JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'assets,isDraft'], { stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    if (!/release not found/i.test(String(error.stderr ?? error.message ?? ''))) throw error;
  }
  if (existing && !existing.isDraft && existing.assets?.some((asset) => asset.name === LIBRARY_FILE)) return { created: false };
  if (existing?.isDraft) gh(['release', 'delete', tag, '--repo', REPO, '--yes']);
  const notes = resolve(dist, '..', 'release-notes.md');
  writeFileSync(notes, releaseNotes(library, dist));
  const paths = readdirSync(dist).sort().map((name) => resolve(dist, name));
  gh(['release', 'create', tag, ...paths, '--repo', REPO, '--target', REVIEWED_COMMIT, '--title', `${LIBRARY_TITLE} ${library.version}`, '--notes-file', notes, '--latest']);
  return { created: true };
}

async function notifySites(version, hooks) {
  if (hooks) return hooks(version);
  const urls = (process.env.VERCEL_DEPLOY_HOOKS ?? '').split('\n').map((item) => item.trim()).filter(Boolean);
  if (!urls.length) throw new Error('No deploy hooks configured; the sites will not rebuild from this release');
  await waitForLatest(version);
  for (const url of urls) {
    const response = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`deploy hook failed (${response.status})`);
  }
  return true;
}

export async function resumeReviewed({
  dist, release, token, api = 'https://zenodo.org/api', fetch: doFetch = fetch, gh, hooks,
} = {}) {
  if (!release || release.version !== REVIEWED_VERSION) {
    return { ok: false, stopped: 'wrong-package-version', version: release?.version ?? null, mutation: 'not-attempted' };
  }
  let inspected;
  try {
    inspected = inspectReviewedDist(dist);
  } catch (error) {
    return { ok: false, stopped: 'bad-artifact', message: error.message, mutation: 'not-attempted' };
  }
  if (!token) return { ok: false, stopped: 'no-token', mutation: 'not-attempted' };
  const expect = reviewedExpect();
  const read = await call(doFetch, `${api}/deposit/depositions/${expect.draftId}`, { method: 'GET', headers: headers(token, false) });
  if (read.redirected || read.status !== 200 || !read.json) {
    return { ok: false, stopped: read.status === 500 ? 'zenodo-500' : 'read-failed', status: read.status, mutation: 'not-attempted' };
  }
  const decision = decideResume(read.json, inspected.files);
  if (decision.action === 'stop') return { ok: false, ...decision };
  const draft = read.json;
  if (decision.action === 'upload' || decision.action === 'publish-existing') {
    const metadata = zenodoMetadata(release, REVIEWED_COMMIT);
    const saved = await call(doFetch, `${api}/deposit/depositions/${expect.draftId}`, {
      method: 'PUT', headers: headers(token, true), body: JSON.stringify({ metadata }),
    });
    if (saved.redirected || saved.status !== 200 || !saved.json) {
      return { ok: false, stopped: saved.status === 500 ? 'zenodo-500' : 'uncertain', request: 'PUT', status: saved.status, mutation: 'unknown', error_id: saved.error_id, message: saved.message };
    }
    if (decision.action === 'upload') {
      const bucket = bucketFor(api, draft);
      if (!bucket) return { ok: false, stopped: 'no-bucket', mutation: 'unknown' };
      const uploaded = await uploadAll(doFetch, api, token, bucket, dist, inspected.files);
      if (!uploaded.ok) return uploaded;
    }
    const published = await call(doFetch, `${api}/deposit/depositions/${expect.draftId}/actions/publish`, {
      method: 'POST', headers: headers(token, false),
    });
    if (published.redirected || (published.status !== 202 && published.status !== 200) || published.json?.doi !== expect.doi) {
      return { ok: false, stopped: published.status === 500 ? 'zenodo-500' : 'uncertain', request: 'POST', status: published.status, mutation: 'unknown', error_id: published.error_id, message: published.message };
    }
  } else if (decision.action !== 'github-only') {
    return { ok: false, stopped: 'unknown-action', action: decision.action, mutation: 'not-attempted' };
  }
  if (!gh) return { ok: false, stopped: 'no-github', mutation: 'unknown' };
  try {
    githubRelease({ library: inspected.library, dist, gh });
    await notifySites(REVIEWED_VERSION, hooks);
  } catch (error) {
    return { ok: false, stopped: 'github', message: error.message, mutation: 'unknown' };
  }
  return { ok: true, action: decision.action, commit: REVIEWED_COMMIT, version: REVIEWED_VERSION, doi: REVIEWED_DOI, mutation: 'published' };
}

function realGh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { dist: { type: 'string', default: 'dist' } } });
  const result = await resumeReviewed({ dist: resolve(values.dist), release: readRelease(), token: process.env.ZENODO_TOKEN ?? '', gh: realGh });
  const text = JSON.stringify(result);
  if (process.env.ZENODO_TOKEN && text.includes(process.env.ZENODO_TOKEN)) {
    console.error('refusing to print a result that contains the Zenodo token');
    process.exit(1);
  }
  console.log(text);
  process.exit(result.ok ? 0 : 1);
}
