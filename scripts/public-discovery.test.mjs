import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyPublicDiscovery } from './verify-public-discovery.mjs';

const index = () => ({
  $schema: 'https://schemas.agentskills.io/discovery/0.2.0/schema.json',
  skills: [{ name: 'test-skill', type: 'archive', url: 'https://example.com/skill.tar.gz', digest: `sha256:${'a'.repeat(64)}` }],
});
const response = (body = index(), status = 200, type = 'application/json') => new Response(JSON.stringify(body), { status, headers: { 'content-type': type } });

test('checks both public sites, both aliases, and both client identities without credentials', async () => {
  const seen = [];
  await verifyPublicDiscovery(async (url, options) => {
    seen.push(`${url} ${options.headers['User-Agent']}`);
    assert.deepEqual(Object.keys(options.headers).sort(), ['Accept', 'User-Agent']);
    assert.ok(options.signal instanceof AbortSignal);
    return response();
  });
  assert.equal(seen.length, 8);
  assert.equal(new Set(seen).size, 8);
  for (const site of ['machinerelations.ai', 'jaxonparrott.com']) {
    for (const path of ['/.well-known/agent-skills', '/.well-known/agent-skills/index.json']) {
      assert.ok(seen.includes(`https://${site}${path} Python-urllib/3.11`));
    }
  }
});

test('fails when only the standard-library client is blocked by the edge', async () => {
  await assert.rejects(verifyPublicDiscovery(async (_url, options) => response(index(), options.headers['User-Agent'].startsWith('Python') ? 403 : 200)), /public discovery must be reachable/);
});

test('rejects HTML challenges even with HTTP 200', async () => {
  await assert.rejects(verifyPublicDiscovery(async () => response(index(), 200, 'text/html')), /JSON expected/);
});

for (const [name, change] of [
  ['wrong schema', x => { x.$schema = 'wrong'; }],
  ['empty catalog', x => { x.skills = []; }],
  ['duplicate name', x => { x.skills.push({ ...x.skills[0] }); }],
  ['non-archive entry', x => { x.skills[0].type = 'endpoint'; }],
  ['relative archive', x => { x.skills[0].url = '/archive'; }],
  ['insecure archive', x => { x.skills[0].url = 'http://example.com/archive'; }],
  ['missing digest', x => { delete x.skills[0].digest; }],
]) {
  test(`rejects ${name}`, async () => {
    const broken = index(); change(broken);
    await assert.rejects(verifyPublicDiscovery(async () => response(broken)));
  });
}
