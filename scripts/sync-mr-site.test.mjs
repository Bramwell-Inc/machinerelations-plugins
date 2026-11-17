import assert from 'node:assert/strict';
import test from 'node:test';
import { syncSite } from './sync-mr-site.mjs';

const branch = 'sync-machine-relations-skill-library';
const manifest = 'contents/data/skill-library.json';
const openPulls = `pulls?state=open&base=main&head=Bramwell-Inc:${branch}`;
const pr = { html_url: 'https://github.com/Bramwell-Inc/machinerelations.ai/pull/1' };

function library(version, extra = {}) {
  return Buffer.from(JSON.stringify({ schema: 'machinerelations_skill_library_v1', version, source: { tag: `v${version}` }, ...extra }));
}

function simulate({ current = library('1.2.8'), pending, open = false, staleBranch = false } = {}) {
  const writes = [];
  const file = (bytes) => ({ content: bytes.toString('base64'), sha: 'file-blob' });
  const repository = async (path, { method = 'GET', body } = {}) => {
    if (method !== 'GET') writes.push({ path, method, body });
    if (path === `${manifest}?ref=main`) return file(current);
    if (path === openPulls) return open ? [pr] : [];
    if (path === `git/ref/heads/${branch}`) return staleBranch ? { object: { sha: 'stale' } } : null;
    if (path === 'git/ref/heads/main') return { object: { sha: 'current-main' } };
    if (path === 'git/refs' || path === `git/refs/heads/${branch}`) {
      pending = current;
      return {};
    }
    if (path === `${manifest}?ref=${branch}`) return file(pending);
    if (path === manifest && method === 'PUT') {
      pending = Buffer.from(body.content, 'base64');
      return {};
    }
    if (path === 'pulls' && method === 'POST') {
      open = true;
      return pr;
    }
    assert.fail(`Unexpected ${method} ${path}`);
  };
  return { repository, writes };
}

test('publishes the exact asset through one PR and retries without another commit or PR', async () => {
  const { repository, writes } = simulate();
  const bytes = library('1.2.9');
  const update = { version: '1.2.9', bytes, repository };
  assert.equal(await syncSite(update), pr.html_url);
  assert.deepEqual(writes.map(({ path, method }) => [method, path]), [['POST', 'git/refs'], ['PUT', manifest], ['POST', 'pulls']]);
  assert.deepEqual(Buffer.from(writes[1].body.content, 'base64'), bytes);
  assert.equal(writes[2].body.base, 'main');
  assert.equal(await syncSite(update), pr.html_url);
  assert.equal(writes.length, 3);
});

test('starts from current main when a branch remains after a squash merge', async () => {
  const { repository, writes } = simulate({ staleBranch: true });
  await syncSite({ version: '1.2.9', bytes: library('1.2.9'), repository });
  assert.deepEqual(writes[0], {
    path: `git/refs/heads/${branch}`,
    method: 'PATCH',
    body: { sha: 'current-main', force: true },
  });
});

test('leaves a current or newer published or pending library alone', async () => {
  for (const state of [{}, { current: library('1.3.0') }, { current: library('1.2.7'), pending: library('1.3.0'), open: true }]) {
    const { repository, writes } = simulate(state);
    await syncSite({ version: '1.2.8', bytes: library('1.2.8'), repository });
    assert.deepEqual(writes, []);
  }
});

test('rejects altered bytes for the same version and a manifest from the wrong release', async () => {
  const { repository, writes } = simulate();
  await assert.rejects(syncSite({ version: '1.2.8', bytes: library('1.2.8', { altered: true }), repository }), /differs from the bytes/);
  await assert.rejects(syncSite({ version: '1.2.9', bytes: library('1.2.8'), repository }), /versions differ/);
  assert.deepEqual(writes, []);
});
