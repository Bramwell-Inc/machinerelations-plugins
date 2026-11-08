import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

const sites = ['https://machinerelations.ai', 'https://jaxonparrott.com'];
const paths = ['/.well-known/agent-skills', '/.well-known/agent-skills/index.json'];
const clients = ['MachineRelationsDiscoveryCheck/1', 'Python-urllib/3.11'];

// Check the currently published library, not the candidate package awaiting release.
// Browser-only success can hide an edge rule that blocks standard machine clients.
export async function verifyPublicDiscovery(request = fetch) {
  for (const site of sites) {
    for (const path of paths) {
      const url = site + path;
      for (const client of clients) {
        const response = await request(url, {
          headers: { 'User-Agent': client, Accept: 'application/json' },
          signal: AbortSignal.timeout(30000),
        });
        const label = `${url} (${client})`;
        assert.equal(response.status, 200, `${label}: public discovery must be reachable`);
        assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/i, `${label}: JSON expected`);
        const index = await response.json();
        assert.equal(index.$schema, 'https://schemas.agentskills.io/discovery/0.2.0/schema.json', label);
        assert.ok(Array.isArray(index.skills) && index.skills.length > 0, `${label}: published skills missing`);
        const names = new Set();
        for (const skill of index.skills) {
          assert.ok(typeof skill.name === 'string' && skill.name.length > 0 && !names.has(skill.name), `${label}: unique skill name required`);
          names.add(skill.name);
          assert.equal(skill.type, 'archive', label);
          assert.equal(new URL(skill.url).protocol, 'https:', `${label}: HTTPS archive required`);
          assert.match(skill.digest, /^sha256:[a-f0-9]{64}$/, `${label}: archive digest required`);
        }
      }
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await verifyPublicDiscovery();
  console.log('Public skill discovery: both sites and aliases accept standard machine clients');
}
