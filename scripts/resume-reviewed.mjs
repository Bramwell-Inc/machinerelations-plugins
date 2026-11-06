// Publish the reviewed 1.2.3 artifact onto draft 24020018.
// The artifact's library.json has null DOIs. This fills that reserved DOI into
// library.json and SHA256SUMS only after the draft read confirms it. The zip,
// skill archives and SOURCE_COMMIT stay the tested bytes. It does not call
// newversion, delete a file, delete a deposition, or delete a GitHub release.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { sha256, writeSums } from './build-release.mjs';
import { COMMIT_FILE, CONCEPT_DOI, LIBRARY_FILE, LIBRARY_TITLE, REPO, SUMS_FILE, readRelease } from './library.mjs';
import { releaseNotes, waitForLatest, zenodoMetadata } from './publish-release.mjs';
import { assessDraft } from './zenodo-draft.mjs';

export const REVIEWED_COMMIT = '9a3357ab787e9f54559474c2f943e775be1e5675';
export const REVIEWED_VERSION = '1.2.3';
export const REVIEWED_DRAFT = '24020018';
export const REVIEWED_CONCEPT = '23749768';
export const REVIEWED_DOI = '10.5281/zenodo.24020018';
export const REVIEWED_CONCEPT_DOI = '10.5281/zenodo.23749768';
export const REVIEWED_RUN = '42274178672';
export const REVIEWED_ARTIFACT = 'machine-relations-index-1.2.3-9a3357a';
export const REVIEWED_ARTIFACT_ID = '13533071382';
export const PRESERVED = [
  'SOURCE_COMMIT',
  'machine-relations-index.zip',
  'skill-machine-relations-index.tar.gz',
  'skill-machine-relations.tar.gz',
  'skill-page-check.tar.gz',
];

const md5 = (bytes) => createHash('md5').update(bytes).digest('hex');
const digestOf = (checksum) => String(checksum ?? '').replace(/^md5:/, '');
const doiUrl = (doi) => (doi ? `https://doi.org/${doi}` : null);

export function reviewedExpect() {
  if (CONCEPT_DOI !== REVIEWED_CONCEPT_DOI) throw new Error(`checkout concept ${CONCEPT_DOI} is not the reviewed concept`);
  return { draftId: REVIEWED_DRAFT, version: REVIEWED_VERSION, concept: REVIEWED_CONCEPT, doi: REVIEWED_DOI };
}

function citationUrl(existing) {
  const token = existing.slice(existing.lastIndexOf(' ') + 1);
  try {
    return new URL(token);
  } catch {
    return null;
  }
}

function cite(existing, id) {
  const expected = new URL(doiUrl(id));
  const present = citationUrl(existing);
  if (present === null) return `${existing} ${expected.href}`;
  const same = present.protocol === expected.protocol
    && present.hostname === expected.hostname
    && present.pathname === expected.pathname
    && present.search === ''
    && present.hash === ''
    && present.username === ''
    && present.password === ''
    && present.port === '';
  if (!same) throw new Error('library citation already names a DOI');
  return existing;
}

export function preservedHashes(dist) {
  return new Map(PRESERVED.map((name) => [name, sha256(readFileSync(resolve(dist, name)))]));
}

function readSums(dist) {
  const lines = readFileSync(resolve(dist, SUMS_FILE), 'utf8').trim().split('\n');
  return lines.map((line) => {
    const [digest, name] = line.split(/\s+/);
    return { digest, name };
  });
}

export function inspectReviewedDist(dist) {
  const recorded = readFileSync(resolve(dist, COMMIT_FILE), 'utf8').trim();
  if (recorded !== REVIEWED_COMMIT) throw new Error(`SOURCE_COMMIT is ${recorded || 'empty'}, the reviewed commit is ${REVIEWED_COMMIT}`);
  const library = JSON.parse(readFileSync(resolve(dist, LIBRARY_FILE), 'utf8'));
  if (library.version !== REVIEWED_VERSION) throw new Error(`library.json is ${library.version}`);
  if (library.source?.commit !== REVIEWED_COMMIT) throw new Error('library.json cites a different commit');
  if (library.source?.tag !== `v${REVIEWED_VERSION}`) throw new Error('library.json cites a different tag');
  const versionDoi = library.doi?.version ?? null;
  const conceptDoi = library.doi?.concept ?? null;
  const original = versionDoi == null && conceptDoi == null;
  const finalized = versionDoi === REVIEWED_DOI && conceptDoi === REVIEWED_CONCEPT_DOI;
  if (!original && !finalized) throw new Error('library.json DOI is neither empty nor the reserved DOI');
  for (const { digest, name } of readSums(dist)) {
    if (sha256(readFileSync(resolve(dist, name))) !== digest) throw new Error(`${name} does not match SHA256SUMS`);
  }
  for (const entry of [library.package, ...library.skills.map((skill) => skill.archive)]) {
    if (sha256(readFileSync(resolve(dist, entry.file))) !== entry.sha256) throw new Error(`${entry.file} does not match library.json`);
  }
  return { library, original };
}

export function finalizeReviewedDist(dist) {
  const before = preservedHashes(dist);
  const library = JSON.parse(readFileSync(resolve(dist, LIBRARY_FILE), 'utf8'));
  const versionDoi = library.doi?.version ?? null;
  const conceptDoi = library.doi?.concept ?? null;
  if (versionDoi == null && conceptDoi == null) {
    library.doi = {
      concept: REVIEWED_CONCEPT_DOI,
      concept_url: doiUrl(REVIEWED_CONCEPT_DOI),
      version: REVIEWED_DOI,
      version_url: doiUrl(REVIEWED_DOI),
    };
    library.citation_concept = cite(library.citation_concept, REVIEWED_CONCEPT_DOI);
    library.citation = cite(library.citation, REVIEWED_DOI);
    writeFileSync(resolve(dist, LIBRARY_FILE), `${JSON.stringify(library, null, 2)}\n`);
    writeSums(dist);
  } else if (versionDoi !== REVIEWED_DOI || conceptDoi !== REVIEWED_CONCEPT_DOI) {
    throw new Error('library.json DOI does not match the reserved DOI');
  }
  const after = preservedHashes(dist);
  for (const [name, digest] of before) {
    if (after.get(name) !== digest) throw new Error(`${name} bytes changed while finalizing the DOI`);
  }
  inspectReviewedDist(dist);
  return JSON.parse(readFileSync(resolve(dist, LIBRARY_FILE), 'utf8'));
}

function md5Map(dist) {
  return new Map(readdirSync(dist).filter((name) => !name.startsWith('.')).map((name) => [name, md5(readFileSync(resolve(dist, name)))]));
}

function sameFiles(listed, files) {
  if (listed.length !== files.size) return false;
  return listed.every((file) => files.get(file.filename) === digestOf(file.checksum));
}

export function decideResume(draft, finalizedMd5) {
  const expect = reviewedExpect();
  if (!draft || typeof draft !== 'object') return { action: 'stop', stopped: 'not-validated', problems: ['body'], mutation: 'not-attempted' };
  if (!Array.isArray(draft.files)) return { action: 'stop', stopped: 'files-unlisted', mutation: 'not-attempted' };
  const published = draft.submitted === true && draft.metadata?.version === expect.version && (draft.doi === expect.doi || draft.metadata?.prereserve_doi?.doi === expect.doi) && String(draft.conceptrecid) === expect.concept;
  if (published) {
    if (!sameFiles(draft.files, finalizedMd5)) return { action: 'stop', stopped: 'files-mismatch', mutation: 'not-attempted' };
    return { action: 'github-only', mutation: 'not-attempted' };
  }
  const problems = assessDraft(draft, expect);
  if (problems.length) return { action: 'stop', stopped: 'not-validated', problems, mutation: 'not-attempted' };
  if (draft.files.length === 0) return { action: 'upload', mutation: 'not-attempted' };
  if (sameFiles(draft.files, finalizedMd5)) return { action: 'publish-existing', mutation: 'not-attempted' };
  return {
    action: 'stop',
    stopped: 'files-remain',
    files: draft.files.map((file) => file.filename).filter(Boolean).sort(),
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
    return { status: null, json: null, redirected: false, dropped: true, ...errorFields('') };
  }
  let text;
  try {
    text = await response.text();
  } catch {
    return { status: response.status ?? null, json: null, redirected: false, dropped: true, ...errorFields('') };
  }
  if (response.status >= 300 && response.status < 400) return { status: response.status, json: null, redirected: true, dropped: false, ...errorFields('') };
  let json = null;
  if (text && response.status !== 204) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: response.status, json, redirected: false, dropped: false, ...errorFields(text) };
}

function uncertain(method, result, stopped) {
  return {
    ok: false,
    stopped,
    request: method,
    status: result.status,
    redirected: result.redirected,
    dropped: result.dropped,
    error_id: result.error_id,
    message: result.message,
    mutation: method === 'GET' ? 'not-attempted' : 'unknown',
  };
}

function failed(method, result) {
  if (result.dropped) return uncertain(method, result, 'dropped-body');
  if (result.redirected) return uncertain(method, result, 'redirect');
  if (result.status === null || result.status === 500) return uncertain(method, result, result.status === 500 ? 'zenodo-500' : 'uncertain');
  if (method === 'GET' && (result.status !== 200 || !result.json)) return uncertain(method, result, 'read-failed');
  if (method !== 'GET' && result.status !== 200 && result.status !== 201 && result.status !== 202) return uncertain(method, result, 'uncertain');
  return null;
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

function revalidate(draft, api) {
  const problems = [...assessDraft(draft, reviewedExpect())];
  if (!Array.isArray(draft?.files)) problems.push('files');
  const bucket = draft ? bucketFor(api, draft) : null;
  if (!bucket) problems.push('bucket');
  return { problems, bucket };
}

async function uploadAll(doFetch, api, token, bucket, dist, files) {
  const uploaded = [];
  for (const name of [...files.keys()].sort()) {
    if (name.includes('/') || name.includes('..')) return { ok: false, stopped: 'bad-filename', mutation: 'unknown', uploaded };
    const bytes = readFileSync(resolve(dist, name));
    const stored = await call(doFetch, `${bucket}/${encodeURIComponent(name)}`, {
      method: 'PUT', timeoutMs: 180_000, headers: headers(token, false), body: bytes,
    });
    const problem = failed('PUT', stored);
    if (problem) return { ...problem, uploaded };
    if (stored.json?.checksum !== `md5:${md5(bytes)}`) {
      return { ok: false, stopped: 'checksum', request: 'PUT', mutation: 'unknown', uploaded };
    }
    uploaded.push(name);
  }
  return { ok: true, uploaded };
}

function previewFinal(dist) {
  const scratch = mkdtempSync(join(tmpdir(), 'mr-finalize-'));
  cpSync(dist, scratch, { recursive: true });
  finalizeReviewedDist(scratch);
  return scratch;
}

function tagCommit(tag, gh) {
  try {
    const body = JSON.parse(gh(['api', `repos/${REPO}/commits/${tag}`], { stdio: ['ignore', 'pipe', 'pipe'] }));
    return { sha: body.sha ?? null };
  } catch (error) {
    const text = String(error.stderr ?? error.message ?? '');
    if (/\b404\b|not found/i.test(text)) return { sha: null };
    return { error };
  }
}

async function matchGithub({ tag, required, gh, readAsset }) {
  let commit;
  try {
    commit = JSON.parse(gh(['api', `repos/${REPO}/commits/${tag}`], { stdio: ['ignore', 'pipe', 'pipe'] })).sha;
  } catch (error) {
    return { ok: false, stopped: 'github', message: error.message };
  }
  if (commit !== REVIEWED_COMMIT) return { ok: false, stopped: 'github-commit', commit };
  let view;
  try {
    view = JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'assets,isDraft,tagName'], { stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    return { ok: false, stopped: 'github', message: error.message };
  }
  if (view.isDraft) return { ok: false, stopped: 'github-draft' };
  const names = new Set((view.assets ?? []).map((asset) => asset.name));
  for (const [name, digest] of required) {
    if (!names.has(name)) return { ok: false, stopped: 'github-asset', missing: name };
    const bytes = await readAsset(name);
    if (sha256(bytes) !== digest) return { ok: false, stopped: 'github-asset', mismatch: name };
  }
  return { ok: true };
}

async function ensureGithub({ dist, gh, readAsset }) {
  const tag = `v${REVIEWED_VERSION}`;
  const required = new Map([...readdirSync(dist)].filter((name) => !name.startsWith('.')).sort().map((name) => [name, sha256(readFileSync(resolve(dist, name)))]));
  let view = null;
  try {
    view = JSON.parse(gh(['release', 'view', tag, '--repo', REPO, '--json', 'assets,isDraft,tagName'], { stdio: ['ignore', 'pipe', 'pipe'] }));
  } catch (error) {
    if (!/release not found/i.test(String(error.stderr ?? error.message ?? ''))) return { ok: false, stopped: 'github', message: error.message };
  }
  if (view?.isDraft) return { ok: false, stopped: 'github-draft', created: false };
  if (view) {
    const matched = await matchGithub({ tag, required, gh, readAsset });
    return matched.ok ? { ok: true, created: false } : { ...matched, created: false };
  }
  const tagged = tagCommit(tag, gh);
  if (tagged.error) return { ok: false, stopped: 'github', message: tagged.error.message, created: false };
  if (tagged.sha && tagged.sha !== REVIEWED_COMMIT) {
    return { ok: false, stopped: 'github-commit', commit: tagged.sha, created: false };
  }
  const notes = resolve(dist, '..', 'release-notes.md');
  writeFileSync(notes, releaseNotes(JSON.parse(readFileSync(resolve(dist, LIBRARY_FILE), 'utf8')), dist));
  const paths = [...required.keys()].map((name) => resolve(dist, name));
  gh(['release', 'create', tag, ...paths, '--repo', REPO, '--target', REVIEWED_COMMIT, '--title', `${LIBRARY_TITLE} ${REVIEWED_VERSION}`, '--notes-file', notes, '--latest']);
  return { ...(await matchGithub({ tag, required, gh, readAsset })), created: true };
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
  dist, release, token, api = 'https://zenodo.org/api', fetch: doFetch = fetch, gh, hooks, readAsset,
} = {}) {
  if (!release || release.version !== REVIEWED_VERSION) {
    return { ok: false, stopped: 'wrong-package-version', version: release?.version ?? null, mutation: 'not-attempted' };
  }
  try {
    inspectReviewedDist(dist);
  } catch (error) {
    return { ok: false, stopped: 'bad-artifact', message: error.message, mutation: 'not-attempted' };
  }
  if (!token) return { ok: false, stopped: 'no-token', mutation: 'not-attempted' };
  const expect = reviewedExpect();
  const read = await call(doFetch, `${api}/deposit/depositions/${expect.draftId}`, { method: 'GET', headers: headers(token, false) });
  const readProblem = failed('GET', read);
  if (readProblem) return readProblem;
  const scratch = previewFinal(dist);
  try {
    const decision = decideResume(read.json, md5Map(scratch));
    if (decision.action === 'stop') return { ok: false, ...decision };
    if (decision.action === 'upload' || decision.action === 'publish-existing') {
      const metadata = zenodoMetadata(release, REVIEWED_COMMIT);
      const saved = await call(doFetch, `${api}/deposit/depositions/${expect.draftId}`, {
        method: 'PUT', headers: headers(token, true), body: JSON.stringify({ metadata }),
      });
      const saveProblem = failed('PUT', saved);
      if (saveProblem) return saveProblem;
      const checked = revalidate(saved.json, api);
      if (checked.problems.length) {
        return { ok: false, stopped: 'not-validated', problems: checked.problems, request: 'PUT', mutation: 'unknown' };
      }
      const afterPut = decideResume(saved.json, md5Map(scratch));
      if (afterPut.action === 'stop') return { ok: false, ...afterPut, mutation: 'unknown' };
      if (afterPut.action !== decision.action) return { ok: false, stopped: 'draft-changed', mutation: 'unknown' };
      if (afterPut.action === 'upload') {
        const uploaded = await uploadAll(doFetch, api, token, checked.bucket, scratch, md5Map(scratch));
        if (!uploaded.ok) return uploaded;
      }
      const published = await call(doFetch, `${api}/deposit/depositions/${expect.draftId}/actions/publish`, {
        method: 'POST', headers: headers(token, false),
      });
      const publishProblem = failed('POST', published);
      if (publishProblem) return publishProblem;
      if (published.json?.doi !== expect.doi) return { ok: false, stopped: 'uncertain', request: 'POST', mutation: 'unknown' };
    }
    if (!gh) return { ok: false, stopped: 'no-github', mutation: 'unknown' };
    const github = await ensureGithub({ dist: scratch, gh, readAsset });
    if (!github.ok) {
      const created = github.created === true;
      return {
        ok: false,
        stopped: github.stopped,
        commit: github.commit,
        missing: github.missing,
        mismatch: github.mismatch,
        message: github.message,
        created,
        mutation: created || decision.action !== 'github-only' ? 'unknown' : 'not-attempted',
      };
    }
    try {
      await notifySites(REVIEWED_VERSION, hooks);
    } catch (error) {
      return { ok: false, stopped: 'hooks', message: error.message, mutation: 'unknown' };
    }
    return { ok: true, action: decision.action, commit: REVIEWED_COMMIT, version: REVIEWED_VERSION, doi: REVIEWED_DOI, mutation: 'published' };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function realGh(args, opts = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', ...opts });
}

async function realReadAsset(name) {
  const dir = mkdtempSync(join(tmpdir(), 'mr-asset-'));
  try {
    execFileSync('gh', ['release', 'download', `v${REVIEWED_VERSION}`, '--repo', REPO, '--pattern', name, '--dir', dir], { stdio: ['ignore', 'pipe', 'pipe'] });
    return readFileSync(join(dir, name));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { dist: { type: 'string', default: 'dist' } } });
  const result = await resumeReviewed({
    dist: resolve(values.dist), release: readRelease(), token: process.env.ZENODO_TOKEN ?? '', gh: realGh, readAsset: realReadAsset,
  });
  const text = JSON.stringify(result);
  if (process.env.ZENODO_TOKEN && text.includes(process.env.ZENODO_TOKEN)) {
    console.error('refusing to print a result that contains the Zenodo token');
    process.exit(1);
  }
  console.log(text);
  process.exit(result.ok ? 0 : 1);
}
