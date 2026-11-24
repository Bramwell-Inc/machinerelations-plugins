import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLink } from './check-links.mjs';

const root = 'https://preview.example';
test('a valid first-party launcher hands off without requiring third-party access', async () => {
  const called = [];
  const get = async (url, extra, redirect) => {
    called.push([url, redirect]);
    return { status: 302, location: 'https://gemini.google.com/gem/example' };
  };
  assert.equal((await checkLink(root, '/ask/gemini/from/index-pages/domains/long-domain.com', get)).status, 302);
  assert.deepEqual(called, [[`${root}/ask/gemini/from/index-pages/domains/long-domain.com`, 'manual']]);
});

test('internal failures, missing redirects and loops remain broken', async () => {
  const get = async (url) => url.endsWith('/start') ? { status: 302, location: '/missing' } : { status: 404 };
  assert.equal((await checkLink(root, '/start', get)).status, 404);
  for (const location of [null, 'javascript:alert(1)', 'http://example.com', 'https://user@example.com/']) {
    assert.equal((await checkLink(root, '/start', async () => ({ status: 302, location }))).status, 0);
  }
  assert.equal((await checkLink(root, '/start', async () => ({ status: 302, location: '/start' }))).error, 'redirect loop');
  assert.equal((await checkLink(root, '/start', async () => ({ status: 0, error: 'fetch failed' }))).status, 0);
});
