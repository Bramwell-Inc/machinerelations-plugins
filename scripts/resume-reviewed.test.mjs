import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256 } from './build-release.mjs';
import { readRelease } from './library.mjs';
import {
  REVIEWED_COMMIT, REVIEWED_DRAFT, REVIEWED_VERSION, decideResume, inspectReviewedDist, resumeReviewed,
} from './resume-reviewed.mjs';

const TOKEN = 'zenodo-test-token-not-real';

function fixture(commit = REVIEWED_COMMIT) {
  const dist = mkdtempSync(join(tmpdir(), 'mr-reviewed-'));
  const zip = Buffer.from('reviewed-zip');
  writeFileSync(join(dist, 'machine-relations-index.zip'), zip);
  writeFileSync(join(dist, 'SOURCE_COMMIT'), `${commit}\n`);
  const library = {
    version: REVIEWED_VERSION,
    doi: { version: '10.5281/zenodo.24020018', concept: '10.5281/zenodo.23749768' },
    source: { commit, tag: `v${REVIEWED_VERSION}` },
    package: { file: 'machine-relations-index.zip', sha256: sha256(zip) },
    skills: [],
  };
  writeFileSync(join(dist, 'library.json'), `${JSON.stringify(library)}\n`);
  const names = ['SOURCE_COMMIT', 'library.json', 'machine-relations-index.zip'];
  const sums = names.map((name) => `${sha256(readFileSync(join(dist, name)))}  ${name}\n`).join('');
  writeFileSync(join(dist, 'SHA256SUMS'), sums);
  return dist;
}

function draft(files, extra = {}) {
  return {
    id: 24020018,
    state: 'unsubmitted',
    submitted: false,
    conceptrecid: '23749768',
    metadata: {
      version: '1.2.3',
      keywords: ['Machine Relations', 'machinerelations-skills-library'],
      prereserve_doi: { doi: '10.5281/zenodo.24020018', recid: 24020018 },
    },
    files,
    links: {},
    ...extra,
  };
}

function serve(onRequest) {
  const calls = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      calls.push({ method: req.method, url: req.url });
      onRequest(req, res, body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    calls,
    api: `http://127.0.0.1:${server.address().port}/api`,
    close: () => new Promise((done) => server.close(done)),
  })));
}

test('a different commit and a 1.2.4 checkout never reach Zenodo', async () => {
  const dist = fixture('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  const fetched = () => { throw new Error('zenodo was called'); };
  const wrongArtifact = await resumeReviewed({ dist, release: readRelease(), token: TOKEN, fetch: fetched });
  assert.equal(wrongArtifact.stopped, 'bad-artifact');
  assert.equal(wrongArtifact.mutation, 'not-attempted');
  const wrongPackage = await resumeReviewed({
    dist: fixture(), release: { version: '1.2.4' }, token: TOKEN, fetch: fetched,
  });
  assert.equal(wrongPackage.stopped, 'wrong-package-version');
  rmSync(dist, { recursive: true, force: true });
});

test('inherited files stop the resume before any write', async () => {
  const dist = fixture();
  const body = draft([{ id: 'fa49275a-26a5-469d-a653-01290c2457f1', filename: 'library.json', checksum: '6d7872a97c2be6850d9ea5bb0e41f7fa' }]);
  const zen = await serve((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); });
  body.links.bucket = `${zen.api}/files/bucket-id`;
  try {
    const result = await resumeReviewed({ dist, release: readRelease(), token: TOKEN, api: zen.api, fetch, gh: () => { throw new Error('github'); } });
    assert.equal(result.stopped, 'files-remain');
    assert.deepEqual(result.files, ['library.json']);
    assert.equal(result.mutation, 'not-attempted');
    assert.deepEqual(zen.calls.map((call) => call.method), ['GET']);
  } finally {
    await zen.close();
    rmSync(dist, { recursive: true, force: true });
  }
});

test('an empty draft uploads the reviewed artifact and does not delete or open a new version', async () => {
  const dist = fixture();
  const before = readFileSync(join(dist, 'SOURCE_COMMIT'), 'utf8');
  const record = draft([]);
  const zen = await serve((req, res, body) => {
    res.setHeader('content-type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify(record));
    if (req.method === 'PUT' && req.url.endsWith('/24020018')) return res.end(JSON.stringify(record));
    if (req.method === 'PUT') {
      const checksum = `md5:${createHash('md5').update(body).digest('hex')}`;
      return res.end(JSON.stringify({ checksum }));
    }
    if (req.method === 'POST' && req.url.endsWith('/actions/publish')) {
      return res.end(JSON.stringify({ doi: '10.5281/zenodo.24020018', conceptrecid: '23749768' }));
    }
    res.writeHead(500);
    return res.end('{}');
  });
  record.links.bucket = `${zen.api}/files/bucket-id`;
  const ghCalls = [];
  const gh = (args) => {
    ghCalls.push(args);
    if (args[1] === 'view') {
      const error = new Error('missing');
      error.stderr = 'release not found';
      throw error;
    }
    return '';
  };
  try {
    const result = await resumeReviewed({
      dist, release: readRelease(), token: TOKEN, api: zen.api, fetch, gh, hooks: async () => true,
    });
    assert.equal(result.ok, true);
    assert.equal(result.mutation, 'published');
    assert.equal(result.commit, REVIEWED_COMMIT);
    assert.equal(readFileSync(join(dist, 'SOURCE_COMMIT'), 'utf8'), before);
    assert.equal(zen.calls.some((call) => call.method === 'DELETE'), false);
    assert.equal(zen.calls.some((call) => call.url.includes('newversion')), false);
    assert.equal(zen.calls.filter((call) => call.method === 'POST').length, 1);
    const create = ghCalls.find((args) => args[1] === 'create');
    assert.ok(create);
    assert.equal(create[create.indexOf('--target') + 1], REVIEWED_COMMIT);
  } finally {
    await zen.close();
    rmSync(dist, { recursive: true, force: true });
  }
});

test('the workflow keeps recovery jobs and will not resume from a push', () => {
  const yaml = readFileSync(new URL('../.github/workflows/package.yml', import.meta.url), 'utf8');
  assert.match(yaml, /default:\s*inspect/);
  assert.match(yaml, /- inspect\n\s+- delete-one\n\s+- resume-reviewed/);
  assert.match(yaml, /inputs\.action != 'resume-reviewed'/);
  assert.match(yaml, /inputs\.action == 'resume-reviewed'/);
  assert.match(yaml, /steps\.trigger\.outputs\.publish == 'true'/);
  assert.match(yaml, new RegExp(`run-id: ${REVIEWED_DRAFT === '24020018' ? '42274178672' : ''}`));
  assert.match(yaml, /machine-relations-index-1\.2\.3-9a3357a/);
  assert.doesNotMatch(yaml, /actions\/newversion/);
  const source = readFileSync(new URL('./resume-reviewed.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /actions\/newversion|method:\s*'DELETE'/);
  const inspected = inspectReviewedDist(fixture());
  assert.equal(decideResume(draft([]), inspected.files).action, 'upload');
});
