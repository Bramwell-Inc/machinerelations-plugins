import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLinks } from './links.mjs';

const root = 'https://preview.example.test';
const page = (...hrefs) => [{ html: hrefs.map((h) => `<a href="${h}">x</a>`).join('') }];
// The deployment: `/ask/*` 302s to another site, `/old` 308s to `/new`, `/gone` is 404, `/busy` 429, `/dead` drops the connection.
const site = {
  '/ask/gemini/from/a': [302, 'https://gemini.example.com/gem/1'],
  '/old': [308, '/new'], '/new': [200], '/to-gone': [302, '/gone'], '/gone': [404], '/busy': [429], '/ok': [200],
};
function request(url) {
  const u = new URL(url);
  if (u.origin !== root || u.pathname === '/dead') return Promise.reject(new TypeError('fetch failed'));
  const [status, location] = site[u.pathname] || [404];
  return Promise.resolve(new Response(null, { status, headers: location ? { location } : {} }));
}
// Following redirects the way Node's fetch does: the other site's answer is unreadable (UND_ERR_HEADERS_OVERFLOW).
async function get(url) {
  try {
    for (;;) {
      const res = await request(url);
      const location = res.headers.get('location');
      if (!location) return { status: res.status, url };
      url = new URL(location, url).href;
    }
  } catch (e) { return { status: 0, error: e.message }; }
}
const broken = async (...hrefs) => (await checkLinks(root, page(...hrefs), { get, request })).defects.map((d) => d.where).sort();

test('a hand-off to another site is not our broken link, even when that site cannot be read', async () => {
  assert.deepEqual(await broken('/ask/gemini/from/a'), []);
});

test('our own failures still block: a 404, a redirect to a 404, a dropped connection', async () => {
  assert.deepEqual(await broken('/ok', '/old', '/busy', '/gone', '/to-gone', '/dead'), ['/dead', '/gone', '/to-gone']);
});
