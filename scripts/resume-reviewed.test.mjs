import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256 } from './build-release.mjs';
import { readRelease } from './library.mjs';
import { verifyDist } from './publish-release.mjs';
import {
  PRESERVED, REVIEWED_COMMIT, REVIEWED_DOI, decideResume, finalizeReviewedDist, inspectReviewedDist, resumeReviewed,
} from './resume-reviewed.mjs';

const TOKEN = 'zenodo-test-token-not-real';
const FIXTURE = fileURLToPath(new URL('./fixtures/reviewed-1.2.3/', import.meta.url));
const API = 'https://zenodo.org/api';
const release = () => readRelease();

function originalDist() {
  const dist = mkdtempSync(join(tmpdir(), 'mr-original-'));
  cpSync(FIXTURE, dist, { recursive: true });
  return dist;
}

function hashes(dist) {
  return new Map(PRESERVED.map((name) => [name, sha256(readFileSync(join(dist, name)))]));
}

function record(files, extra = {}) {
  return {
    id: 24020018,
    state: 'unsubmitted',
    submitted: false,
    conceptrecid: '23749768',
    metadata: {
      version: '1.2.3',
      keywords: ['Machine Relations', 'machinerelations-skills-library'],
      prereserve_doi: { doi: REVIEWED_DOI, recid: 24020018 },
    },
    files,
    links: { bucket: `${API}/files/bucket-id` },
    ...extra,
  };
}

function client(handler) {
  const calls = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ method: init.method, url: String(url) });
      const result = await handler({ method: init.method, url: String(url), body: init.body });
      if (result.textThrow) return { status: result.status ?? 200, text: async () => { throw new Error('dropped'); } };
      const body = result.body ?? '';
      return { status: result.status ?? 200, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
    },
  };
}

function githubFor(dir, { draft = false, commit = REVIEWED_COMMIT, assets = null, libraryBytes = null, missing = false } = {}) {
  const names = assets ?? [...PRESERVED, 'library.json', 'SHA256SUMS'];
  const calls = [];
  let created = false;
  const gh = (args) => {
    calls.push(args);
    if (args.includes('delete')) throw new Error('release delete is outside this recovery');
    if (args[0] === 'api') return JSON.stringify({ sha: commit });
    if (args[1] === 'view') {
      if (missing && !created) {
        const error = new Error('missing');
        error.stderr = 'release not found';
        throw error;
      }
      return JSON.stringify({ isDraft: draft, tagName: 'v1.2.3', assets: names.map((name) => ({ name })) });
    }
    if (args[1] === 'create') {
      created = true;
      return '';
    }
    throw new Error(args.join(' '));
  };
  const readAsset = async (name) => (name === 'library.json' && libraryBytes ? libraryBytes : readFileSync(join(dir, name)));
  return { gh, readAsset, calls, created: () => created };
}

test('the original artifact has null DOIs and finalizing keeps the tested bytes', () => {
  const dist = originalDist();
  const before = hashes(dist);
  const sums = readFileSync(join(dist, 'SHA256SUMS'), 'utf8');
  assert.equal(readFileSync(join(dist, 'SOURCE_COMMIT'), 'utf8').trim(), REVIEWED_COMMIT);
  const inspected = inspectReviewedDist(dist);
  assert.equal(inspected.original, true);
  assert.equal(inspected.library.doi.version, null);
  assert.throws(() => verifyDist(dist, '1.2.3'), /no DOI/);
  const library = finalizeReviewedDist(dist);
  assert.equal(library.doi.version, REVIEWED_DOI);
  assert.equal(library.doi.concept, '10.5281/zenodo.23749768');
  assert.match(library.citation, new RegExp(REVIEWED_DOI));
  assert.deepEqual(hashes(dist), before);
  const after = readFileSync(join(dist, 'SHA256SUMS'), 'utf8');
  for (const name of PRESERVED) assert.equal(after.includes(sums.split('\n').find((line) => line.endsWith(`  ${name}`))), true);
  assert.notEqual(after, sums);
  rmSync(dist, { recursive: true, force: true });
});

test('a missing or null file list is not an empty draft', async () => {
  for (const files of [null, undefined]) {
    const dist = originalDist();
    const body = record(files);
    if (files === undefined) delete body.files;
    const zen = client(async () => ({ body }));
    const result = await resumeReviewed({ dist, release: release(), token: TOKEN, fetch: zen.fetch, gh: () => { throw new Error('github'); } });
    assert.equal(result.stopped, 'files-unlisted');
    assert.equal(result.mutation, 'not-attempted');
    assert.deepEqual(zen.calls.map((call) => call.method), ['GET']);
    rmSync(dist, { recursive: true, force: true });
  }
});

test('inherited files stop the resume before any write', async () => {
  const dist = originalDist();
  const zen = client(async () => ({ body: record([{ filename: 'library.json', checksum: '6d7872a97c2be6850d9ea5bb0e41f7fa' }]) }));
  const result = await resumeReviewed({ dist, release: release(), token: TOKEN, fetch: zen.fetch });
  assert.equal(result.stopped, 'files-remain');
  assert.equal(result.mutation, 'not-attempted');
  assert.deepEqual(zen.calls.map((call) => call.method), ['GET']);
  rmSync(dist, { recursive: true, force: true });
});

test('an empty original artifact is finalized on upload and a metadata response is revalidated', async () => {
  const dist = originalDist();
  const finalized = originalDist();
  finalizeReviewedDist(finalized);
  const zip = readFileSync(join(FIXTURE, 'machine-relations-index.zip'));
  const empty = record([]);
  const zen = client(async ({ method, url, body }) => {
    if (method === 'PUT' && url.endsWith('/24020018')) return { body: empty };
    if (method === 'PUT') {
      const bytes = Buffer.from(body);
      if (url.endsWith('/machine-relations-index.zip')) assert.deepEqual(bytes, zip);
      if (url.endsWith('/library.json')) assert.match(bytes.toString('utf8'), new RegExp(REVIEWED_DOI));
      if (url.endsWith('/SOURCE_COMMIT')) assert.equal(bytes.toString('utf8').trim(), REVIEWED_COMMIT);
      return { status: 201, body: { checksum: `md5:${createHash('md5').update(bytes).digest('hex')}` } };
    }
    if (method === 'POST') return { status: 202, body: { doi: REVIEWED_DOI } };
    return { body: empty };
  });
  const github = githubFor(finalized, { missing: true });
  const result = await resumeReviewed({
    dist, release: release(), token: TOKEN, fetch: zen.fetch, gh: github.gh, readAsset: github.readAsset, hooks: async () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.mutation, 'published');
  assert.equal(zen.calls.some((call) => call.method === 'DELETE'), false);
  assert.equal(zen.calls.some((call) => call.url.includes('newversion')), false);
  assert.equal(github.calls.some((args) => args.includes('delete')), false);
  assert.equal(github.calls.find((args) => args[1] === 'create')[github.calls.find((args) => args[1] === 'create').indexOf('--target') + 1], REVIEWED_COMMIT);
  assert.deepEqual(hashes(dist), hashes(FIXTURE));
  rmSync(dist, { recursive: true, force: true });
  rmSync(finalized, { recursive: true, force: true });
});

test('a metadata response without a file list does not upload', async () => {
  const dist = originalDist();
  const saved = record(null);
  const zen = client(async ({ method, url }) => {
    if (method === 'PUT' && url.endsWith('/24020018')) return { body: saved };
    return { body: record([]) };
  });
  const result = await resumeReviewed({ dist, release: release(), token: TOKEN, fetch: zen.fetch });
  assert.equal(result.mutation, 'unknown');
  assert.equal(result.stopped, 'not-validated');
  assert.equal(zen.calls.some((call) => call.url.includes('/files/bucket-id/')), false);
  rmSync(dist, { recursive: true, force: true });
});

test('redirects, a 500, a checksum mismatch and a dropped body stay uncertain', async () => {
  const cases = [
    { name: 'redirect', respond: { status: 302, body: '' }, stopped: 'redirect' },
    { name: 'dropped', respond: { textThrow: true }, stopped: 'dropped-body' },
  ];
  for (const item of cases) {
    const dist = originalDist();
    const zen = client(async ({ method, url }) => (method === 'PUT' && url.endsWith('/24020018') ? item.respond : { body: record([]) }));
    const result = await resumeReviewed({ dist, release: release(), token: TOKEN, fetch: zen.fetch });
    assert.equal(result.stopped, item.stopped, item.name);
    assert.equal(result.mutation, 'unknown', item.name);
    assert.equal(zen.calls.some((call) => call.url.includes('/files/bucket-id/')), false, item.name);
    rmSync(dist, { recursive: true, force: true });
  }

  const checksum = originalDist();
  const bad = client(async ({ method, url, body }) => {
    if (method === 'PUT' && url.endsWith('/24020018')) return { body: record([]) };
    if (method === 'PUT') return { status: 201, body: { checksum: 'md5:00000000000000000000000000000000' } };
    return { body: record([]) };
  });
  const mismatched = await resumeReviewed({ dist: checksum, release: release(), token: TOKEN, fetch: bad.fetch });
  assert.equal(mismatched.stopped, 'checksum');
  assert.equal(mismatched.mutation, 'unknown');
  assert.equal(bad.calls.some((call) => call.method === 'POST'), false);
  rmSync(checksum, { recursive: true, force: true });

  const failed = originalDist();
  const boom = client(async ({ method, url, body }) => {
    if (method === 'POST') return { status: 500, body: { message: 'internal' } };
    if (method === 'PUT' && !url.endsWith('/24020018')) {
      return { status: 201, body: { checksum: `md5:${createHash('md5').update(Buffer.from(body)).digest('hex')}` } };
    }
    return { body: record([]) };
  });
  const published = await resumeReviewed({ dist: failed, release: release(), token: TOKEN, fetch: boom.fetch });
  assert.equal(published.stopped, 'zenodo-500');
  assert.equal(published.mutation, 'unknown');
  assert.equal(boom.calls.filter((call) => call.method === 'POST').length, 1);
  rmSync(failed, { recursive: true, force: true });
});

test('a published record is adopted only when the files, release bytes and tag commit match', async () => {
  const dist = originalDist();
  const finalized = originalDist();
  finalizeReviewedDist(finalized);
  const listed = ['library.json', 'SHA256SUMS', ...PRESERVED].map((name) => ({
    filename: name,
    checksum: createHash('md5').update(readFileSync(join(finalized, name))).digest('hex'),
  }));
  const published = record(listed, { submitted: true, doi: REVIEWED_DOI, state: 'done' });
  const zen = client(async () => ({ body: published }));
  const github = githubFor(finalized);
  const result = await resumeReviewed({
    dist, release: release(), token: TOKEN, fetch: zen.fetch, gh: github.gh, readAsset: github.readAsset, hooks: async () => true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.action, 'github-only');
  assert.equal(github.created(), false);
  assert.equal(zen.calls.some((call) => call.method !== 'GET'), false);
  assert.equal(github.calls.some((args) => args.includes('delete')), false);
  rmSync(dist, { recursive: true, force: true });

  const wrongCommit = githubFor(finalized, { commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
  const commit = await resumeReviewed({
    dist: originalDist(), release: release(), token: TOKEN, fetch: client(async () => ({ body: published })).fetch,
    gh: wrongCommit.gh, readAsset: wrongCommit.readAsset,
  });
  assert.equal(commit.stopped, 'github-commit');
  assert.equal(wrongCommit.created(), false);

  const wrongBytes = githubFor(finalized, { libraryBytes: Buffer.from('not the library') });
  const bytes = await resumeReviewed({
    dist: originalDist(), release: release(), token: TOKEN, fetch: client(async () => ({ body: published })).fetch,
    gh: wrongBytes.gh, readAsset: wrongBytes.readAsset,
  });
  assert.equal(bytes.stopped, 'github-asset');

  const draftRelease = githubFor(finalized, { draft: true });
  const draft = await resumeReviewed({
    dist: originalDist(), release: release(), token: TOKEN, fetch: client(async () => ({ body: published })).fetch,
    gh: draftRelease.gh, readAsset: draftRelease.readAsset,
  });
  assert.equal(draft.stopped, 'github-draft');
  assert.equal(draftRelease.calls.some((args) => args.includes('delete')), false);
  rmSync(finalized, { recursive: true, force: true });
});

test('the workflow keeps recovery jobs and will not resume from a push', () => {
  const yaml = readFileSync(new URL('../.github/workflows/package.yml', import.meta.url), 'utf8');
  assert.match(yaml, /default:\s*inspect/);
  assert.match(yaml, /- inspect\n\s+- delete-one\n\s+- resume-reviewed/);
  assert.match(yaml, /inputs\.action != 'resume-reviewed'/);
  assert.match(yaml, /inputs\.action == 'resume-reviewed'/);
  assert.match(yaml, /steps\.trigger\.outputs\.publish == 'true'/);
  assert.match(yaml, /run-id: 42274178672/);
  assert.match(yaml, /machine-relations-index-1\.2\.3-9a3357a/);
  const source = readFileSync(new URL('./resume-reviewed.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /actions\/newversion|method:\s*'DELETE'|release',\s*'delete'/);
  assert.equal(decideResume({ files: null }, new Map()).stopped, 'files-unlisted');
  assert.equal(decideResume({ files: [] }, new Map()).action === 'upload' || decideResume(record([]), new Map()).stopped !== 'files-unlisted', true);
});
