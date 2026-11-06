import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { recoverDraft, fileDeletePath } from './zenodo-draft.mjs';
import { CONCEPT_MARKER } from './publish-release.mjs';

const TOKEN = 'zenodo-test-token-not-real';
const draft = () => ({
  id: 24020018,
  state: 'unsubmitted',
  submitted: false,
  conceptrecid: '23749768',
  metadata: {
    version: '1.2.3',
    keywords: ['Machine Relations', CONCEPT_MARKER],
    prereserve_doi: { doi: '10.5281/zenodo.24020018', recid: 24020018 },
  },
  files: [{
    id: '52ab3369-23f4-48e2-979e-6d0e71c0c677',
    filename: 'SOURCE_COMMIT',
    checksum: 'md5:abc',
    links: { self: '' },
  }],
});

function serve(handler) {
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? '' });
    try { handler(req, res, ''); } catch (error) { if (!res.headersSent) res.writeHead(500); res.end(String(error)); }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({
    server,
    calls,
    api: `http://127.0.0.1:${server.address().port}/api`,
    close: () => new Promise((done) => server.close(done)),
  })));
}

function expectOf(api) {
  const record = draft();
  record.files[0].links.self = `${api}/deposit/depositions/24020018/files/52ab3369-23f4-48e2-979e-6d0e71c0c677`;
  return record;
}

const base = {
  token: TOKEN,
  draftId: '24020018',
  version: '1.2.3',
  concept: '23749768',
  doi: '10.5281/zenodo.24020018',
};

test('inspect reads the draft and does not delete, publish, or open a new version', async () => {
  const zen = await serve((req, res) => res.end(JSON.stringify(expectOf(zen.api))));
  const result = await recoverDraft({ ...base, api: zen.api, action: 'inspect', fetch: fetch });
  assert.equal(result.ok, true);
  assert.equal(result.view.doi, '10.5281/zenodo.24020018');
  assert.equal(result.view.conceptrecid, '23749768');
  assert.equal(result.view.state, 'unsubmitted');
  assert.equal(result.view.files[0].filename, 'SOURCE_COMMIT');
  assert.deepEqual(zen.calls.map((call) => call.method), ['GET']);
  assert.equal(JSON.stringify(result).includes(TOKEN), false);
  await zen.close();
});

test('a draft that is not the reserved unsubmitted version is not deleted', async () => {
  const zen = await serve((req, res) => res.end(JSON.stringify({ ...expectOf('http://unused'), state: 'done', submitted: true })));
  const result = await recoverDraft({
    ...base, api: zen.api, action: 'delete-one', fileId: '52ab3369-23f4-48e2-979e-6d0e71c0c677', fetch: fetch,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stopped, 'not-validated');
  assert.equal(result.mutation, 'not-attempted');
  assert.equal(Object.hasOwn(result, 'deleted'), false);
  assert.deepEqual(zen.calls.map((call) => call.method), ['GET']);
  await zen.close();
});

test('delete-one removes only the named draft file and stops on 500', async () => {
  const fileId = '52ab3369-23f4-48e2-979e-6d0e71c0c677';
  const zen = await serve((req, res) => {
    if (req.method === 'DELETE') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 500, error_id: '28ec60e7c35a4383880f063fa24efb41', message: 'internal' }));
      return;
    }
    res.end(JSON.stringify(expectOf(zen.api)));
  });
  const result = await recoverDraft({ ...base, api: zen.api, action: 'delete-one', fileId, fetch: fetch });
  assert.equal(result.stopped, 'zenodo-500');
  assert.equal(result.mutation, 'unknown');
  assert.equal(Object.hasOwn(result, 'deleted'), false);
  assert.equal(result.error_id, '28ec60e7c35a4383880f063fa24efb41');
  assert.deepEqual(zen.calls.map((call) => `${call.method} ${call.url}`), [
    'GET /api/deposit/depositions/24020018',
    `DELETE /api${fileDeletePath('24020018', fileId)}`,
  ]);
  await zen.close();
});

test('one successful delete does not continue into another write', async () => {
  const fileId = '52ab3369-23f4-48e2-979e-6d0e71c0c677';
  const zen = await serve((req, res) => {
    if (req.method === 'DELETE') { res.writeHead(204); return res.end(); }
    res.end(JSON.stringify(expectOf(zen.api)));
  });
  const result = await recoverDraft({ ...base, api: zen.api, action: 'delete-one', fileId, fetch: fetch });
  assert.equal(result.ok, true);
  assert.equal(result.deleted, fileId);
  assert.equal(zen.calls.filter((call) => call.method !== 'GET').length, 1);
  await zen.close();
});

test('a file id that is not on the draft is not deleted', async () => {
  const zen = await serve((req, res) => res.end(JSON.stringify(expectOf(zen.api))));
  const result = await recoverDraft({
    ...base, api: zen.api, action: 'delete-one', fileId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', fetch: fetch,
  });
  assert.equal(result.stopped, 'file-not-on-draft');
  assert.deepEqual(zen.calls.map((call) => call.method), ['GET']);
  await zen.close();
});

test('the package workflow dispatches a dry-run inspect and cannot publish from it', () => {
  const yaml = readFileSync(new URL('../.github/workflows/package.yml', import.meta.url), 'utf8');
  assert.match(yaml, /default:\s*inspect/);
  assert.match(yaml, /- inspect\n\s+- delete-one/);
  assert.doesNotMatch(yaml, /expect_version|expect_concept|expect_doi/);
  assert.match(yaml, /steps\.trigger\.outputs\.publish == 'true'/);
  const publishAt = yaml.indexOf('node scripts/publish-release.mjs');
  const triggerAt = yaml.indexOf('node scripts/release-trigger.mjs');
  assert.ok(triggerAt !== -1 && publishAt !== -1 && triggerAt < publishAt);
});

test('a transport failure after delete is unknown and is not retried', async () => {
  const fileId = '52ab3369-23f4-48e2-979e-6d0e71c0c677';
  let deletes = 0;
  const zen = await serve((req, res) => res.end(JSON.stringify(expectOf(zen.api))));
  const result = await recoverDraft({
    ...base,
    api: zen.api,
    action: 'delete-one',
    fileId,
    fetch: async (url, init) => {
      if (init?.method === 'DELETE') {
        deletes += 1;
        throw new Error('socket hang up');
      }
      return fetch(url, init);
    },
  });
  assert.equal(result.stopped, 'uncertain');
  assert.equal(result.mutation, 'unknown');
  assert.equal(Object.hasOwn(result, 'deleted'), false);
  assert.equal(deletes, 1);
  await zen.close();
});

function cli(api, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./zenodo-draft.mjs', import.meta.url))], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, ZENODO_TOKEN: TOKEN, ZENODO_API: api, DRAFT_ID: '24020018', ...env },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

test('the cli reports a version mismatch without writing or printing the token', { timeout: 8000 }, async () => {
  const zen = await serve((req, res) => res.end(JSON.stringify({ ...expectOf(zen.api), metadata: { ...expectOf(zen.api).metadata, version: '1.2.2' } })));
  const ran = await cli(zen.api, { ACTION: 'delete-one', FILE_ID: '52ab3369-23f4-48e2-979e-6d0e71c0c677' });
  assert.equal(ran.status, 1);
  assert.match(ran.stdout, /version/);
  assert.equal(ran.stdout.includes(TOKEN) || ran.stderr.includes(TOKEN), false);
  assert.deepEqual(zen.calls.map((call) => call.method), ['GET']);
  await zen.close();
});

test('the cli refuses a file link that is not this draft and does not follow a redirect', { timeout: 8000 }, async () => {
  const linked = await serve((req, res) => {
    const body = expectOf(zenApi(req));
    body.files[0].links.self = 'https://zenodo.org/api/records/24001297/files/SOURCE_COMMIT/content';
    res.end(JSON.stringify(body));
  });
  const refused = await cli(linked.api, { ACTION: 'delete-one', FILE_ID: '52ab3369-23f4-48e2-979e-6d0e71c0c677' });
  assert.equal(refused.status, 1);
  assert.match(refused.stdout, /file-not-on-draft/);
  assert.deepEqual(linked.calls.map((call) => call.method), ['GET']);
  await linked.close();

  const redirected = await serve((req, res) => {
    res.writeHead(302, { location: 'https://zenodo.org/api/deposit/depositions/24001297' });
    res.end(TOKEN);
  });
  const stopped = await cli(redirected.api, { ACTION: 'inspect' });
  assert.equal(stopped.status, 1);
  assert.match(stopped.stdout, /read-failed/);
  assert.equal(stopped.stdout.includes(TOKEN) || stopped.stderr.includes(TOKEN), false);
  assert.deepEqual(redirected.calls.map((call) => call.method), ['GET']);
  await redirected.close();
});

function zenApi(req) {
  return `http://127.0.0.1:${req.socket.localPort}/api`;
}

test('the cli suppresses a token echoed by a 500', { timeout: 8000 }, async () => {
  const zen = await serve((req, res) => {
    if (req.method === 'DELETE') {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 500, error_id: 'abc', message: `leaked ${TOKEN}` }));
      return;
    }
    res.end(JSON.stringify(expectOf(zen.api)));
  });
  const ran = await cli(zen.api, { ACTION: 'delete-one', FILE_ID: '52ab3369-23f4-48e2-979e-6d0e71c0c677' });
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /refusing to print/);
  assert.equal(ran.stdout.includes(TOKEN), false);
  assert.equal(ran.stderr.includes(TOKEN), false);
  assert.deepEqual(zen.calls.map((call) => call.method), ['GET', 'DELETE']);
  await zen.close();
});
