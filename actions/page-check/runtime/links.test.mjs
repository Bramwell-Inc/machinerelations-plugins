import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkLinks, reader } from './links.mjs';

const root = 'https://preview.example.test';
const page = (...hrefs) => [{ html: hrefs.map((h) => `<a href="${h}">x</a>`).join('') }];
// The deployment: `/ask/*` 302s to another site, `/old` 308s to `/new`, `/gone` is 404, `/busy` 429, `/dead` drops the connection.
const site = {
  '/ask/gemini/from/a': [302, 'https://gemini.example.com/gem/1'],
  '/old': [308, '/new'], '/new': [200], '/to-gone': [302, '/gone'], '/gone': [404], '/busy': [429], '/ok': [200], '/loop': [302, '/loop'],
};
// One fetch with redirect: 'manual'. The other site cannot be read at all, as Node cannot read Gemini (UND_ERR_HEADERS_OVERFLOW).
function request(url) {
  const u = new URL(url);
  if (u.origin !== root || u.pathname === '/dead') return Promise.reject(new TypeError('fetch failed'));
  const [status, location] = site[u.pathname] || [404];
  return Promise.resolve(new Response(null, { status, headers: location ? { location } : {} }));
}
const get = reader(async () => ({}), 'page-check-test', request);
const broken = async (...hrefs) => (await checkLinks(root, page(...hrefs), { get })).defects.map((d) => d.where).sort();

test('a hand-off to another site is not our broken link, even when that site cannot be read', async () => {
  assert.deepEqual(await broken('/ask/gemini/from/a'), []);
});

test('our own failures still block: a 404, a redirect to a 404, a dropped connection, a redirect loop', async () => {
  assert.deepEqual(await broken('/ok', '/old', '/busy', '/gone', '/to-gone', '/dead', '/loop'), ['/dead', '/gone', '/loop', '/to-gone']);
});

test('access headers reach the deployment only, never a site it hands off to', async (t) => {
  const ours = []; const theirs = [];
  const other = http.createServer((req, res) => { theirs.push(req.headers); res.end('gem'); });
  await new Promise((ok) => other.listen(0, '127.0.0.1', ok));
  const gem = `http://localhost:${other.address().port}/gem`;
  const preview = http.createServer((req, res) => {
    ours.push(req.headers);
    if (req.url === '/ask') res.writeHead(302, { location: gem });
    else if (req.url === '/old') res.writeHead(308, { location: '/new' });
    res.end('ok');
  });
  await new Promise((ok) => preview.listen(0, '127.0.0.1', ok));
  t.after(() => { for (const s of [preview, other]) { s.closeAllConnections(); s.close(); } });
  const at = `http://127.0.0.1:${preview.address().port}`;
  const read = reader(async (url) => (new URL(url).origin === at ? { 'x-vercel-trusted-oidc-idp-token': 'oidc-jwt' } : {}), 'page-check-test');
  const handoff = await read(`${at}/ask`);
  const moved = await read(`${at}/old`);
  assert.deepEqual(theirs.map((h) => h['x-vercel-trusted-oidc-idp-token']), [undefined]);
  assert.deepEqual(ours.map((h) => h['x-vercel-trusted-oidc-idp-token']), ['oidc-jwt', 'oidc-jwt', 'oidc-jwt']);
  assert.deepEqual([handoff.status, handoff.url, moved.url], [200, gem, `${at}/new`]);
});
