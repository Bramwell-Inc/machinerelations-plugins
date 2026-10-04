// Cross-client invariants that a directory ZIP must satisfy. No network or deps.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = resolve('plugins/machine-relations-index');
const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const codex = read('plugin.json');
const claude = read('.claude-plugin/plugin.json');
assert.equal(codex.name, 'machine-relations-index');
assert.equal(claude.name, codex.name);
assert.equal(claude.version, codex.version, 'Both clients must ship the same package version');
assert.match(codex.version, /^\d+\.\d+\.\d+$/);

// Git-backed clients cache versions: changing packaged files without a bump
// must fail at the PR/push seam, not become a release-owner memory task.
const base = process.env.PACKAGE_BASE_SHA;
if (base && !/^0+$/.test(base)) {
  assert.match(base, /^[a-f0-9]{40}$/);
  const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--', 'plugins/machine-relations-index'], { encoding: 'utf8' }).trim();
  if (changed) {
    const previous = JSON.parse(execFileSync('git', ['show', `${base}:plugins/machine-relations-index/plugin.json`], { encoding: 'utf8' }));
    const before = previous.version.split('.').map(Number);
    const after = codex.version.split('.').map(Number);
    assert.ok(after.some((part, i) => part > before[i] && after.slice(0, i).every((n, j) => n === before[j])), 'Packaged files changed: increase both manifest versions before shipping');
  }
}

const endpoint = 'https://machinerelations.ai/mcp';
for (const [file, transport] of [['mcp.json', 'streamable-http'], ['.mcp.json', 'http']]) {
  const servers = read(file).mcpServers;
  assert.deepEqual(Object.keys(servers), ['machine-relations-index']);
  assert.equal(servers[codex.name].url, endpoint);
  assert.equal(servers[codex.name].type, transport);
}
for (const file of [claude.icon, codex.extensions['com.openai'].interface.logo, codex.extensions['com.openai'].interface.composerIcon]) {
  assert.equal(typeof file, 'string');
  const path = resolve(root, file);
  assert.ok(!relative(root, path).startsWith('..'), 'Assets must be in the uploaded package');
  assert.ok(existsSync(path), `Missing package asset: ${file}`);
}
const skill = readFileSync(resolve(root, 'skills/machine-relations-index/SKILL.md'), 'utf8');
assert.ok(skill.includes('source.guidance'), 'The installed skill must read the live interpretation owner');
for (const client of ['.agents/plugins', '.claude-plugin']) {
  const marketplace = JSON.parse(readFileSync(`${client}/marketplace.json`, 'utf8'));
  const plugin = marketplace.plugins.find((p) => p.name === codex.name);
  assert.ok(plugin, `${client} must expose the package`);
  assert.equal(typeof plugin.source === 'string' ? plugin.source : plugin.source.path, './plugins/machine-relations-index');
}
console.log(`Validated ${codex.name} ${codex.version}`);
