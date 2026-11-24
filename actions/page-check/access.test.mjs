import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

test('sends the OIDC token and bypass only to the preview host, and refreshes nothing early', async () => {
  let calls = 0;
  const srv = http.createServer((req, res) => {
    calls += 1;
    assert.match(req.url, /audience=https%3A%2F%2Fgithub.com%2FAuthorityTech/);
    assert.equal(req.headers.authorization, 'Bearer req-token');
    res.end(JSON.stringify({ value: 'oidc-jwt' }));
  });
  await new Promise((ok) => srv.listen(0, ok));
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL = `http://127.0.0.1:${srv.address().port}/token?api-version=2.0`;
  process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN = 'req-token';
  process.env.GITHUB_REPOSITORY_OWNER = 'AuthorityTech';
  const { previewAccess } = await import(`./access.mjs?${Date.now()}`);
  const a = previewAccess({ previewUrl: 'https://site-git-x-team.vercel.app', bypass: 'b' });
  assert.deepEqual(await a.forUrl('https://site-git-x-team.vercel.app/blog/x'), { 'x-vercel-protection-bypass': 'b', 'x-vercel-set-bypass-cookie': 'true', 'x-vercel-trusted-oidc-idp-token': 'oidc-jwt' });
  assert.deepEqual(await a.forUrl('https://fonts.googleapis.com/css'), {});
  assert.deepEqual(await a.forUrl('https://authoritytech.io/'), {});
  assert.deepEqual(await a.forUrl('not a url'), {});
  await a.forUrl('https://site-git-x-team.vercel.app/');
  assert.equal(calls, 1);
  // Contexts that load production get no route at all.
  let routed = 0; const ctx = { route: async () => { routed += 1; } };
  await a.attach(ctx, 'https://authoritytech.io');
  await a.attach(ctx, 'https://site-git-x-team.vercel.app');
  assert.equal(routed, 1);
  srv.close();
});

test('a preview request is fetched without following redirects, so a hand-off never carries the headers', async () => {
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_URL;
  delete process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  const { previewAccess } = await import(`./access.mjs?bare-${Date.now()}`);
  const a = previewAccess({ previewUrl: 'https://site-git-x-team.vercel.app', bypass: 'b' });
  let handler; await a.attach({ route: async (glob, h) => { handler = h; } }, 'https://site-git-x-team.vercel.app');
  const calls = [];
  const route = (url) => ({
    request: () => ({ url: () => url, headers: () => ({ accept: '*/*' }) }),
    continue: async (o) => { calls.push(['continue', url, o]); },
    fetch: async (o) => { calls.push(['fetch', url, o]); return 'fetched'; },
    fulfill: async (o) => { calls.push(['fulfill', url, o]); },
  });
  await handler(route('https://site-git-x-team.vercel.app/ask/gemini'));
  await handler(route('https://gemini.google.com/gem/1'));
  assert.deepEqual(calls, [
    ['fetch', 'https://site-git-x-team.vercel.app/ask/gemini', { headers: { accept: '*/*', 'x-vercel-protection-bypass': 'b', 'x-vercel-set-bypass-cookie': 'true' }, maxRedirects: 0, timeout: 0 }],
    ['fulfill', 'https://site-git-x-team.vercel.app/ask/gemini', { response: 'fetched' }],
    ['continue', 'https://gemini.google.com/gem/1', undefined],
  ]);
});
