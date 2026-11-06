import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
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
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, authorization: req.headers.authorization ?? '' });
      handler(req, res, body);
    });
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
  assert.equal(result.deleted, false);
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
  assert.equal(result.deleted, false);
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
  assert.match(yaml, /ZENODO_TOKEN: \$\{\{ secrets\.ZENODO_TOKEN \}\}/);
  assert.doesNotMatch(yaml, /ZENODO_TOKEN: \$\{\{ secrets\.(?!ZENODO_TOKEN)/);
  assert.match(yaml, /github\.event_name == 'push' && github\.ref == 'refs\/heads\/main'/);
  assert.match(yaml, /github\.event_name == 'workflow_dispatch'/);
  assert.doesNotMatch(yaml, /actions\/newversion|actions\/publish|depositions\/\$\{\{[^}]*\}\}"?\s*$/m);
});
