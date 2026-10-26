import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));
const expected = read('plugins/machine-relations-index/plugin.json');
const codex = read(join(process.env.RUNNER_TEMP, 'mr-codex-install.json'));
const claude = read(join(process.env.RUNNER_TEMP, 'mr-claude-install.json'));
const claudeEntry = claude.find((entry) => entry.id === 'machine-relations-index@machinerelations');
assert.ok(claudeEntry, 'Claude Code must report the installed plugin');

for (const [host, installed] of [['Codex', codex], ['Claude Code', claudeEntry]]) {
  assert.equal(installed.version, expected.version, `${host} installed the candidate version`);
  const root = installed.installedPath ?? installed.installPath;
  assert.equal(typeof root, 'string', `${host} returns an installed path`);
  for (const name of ['machine-relations', 'machine-relations-index']) {
    assert.equal(
      readFileSync(join(root, `skills/${name}/SKILL.md`), 'utf8'),
      readFileSync(`plugins/machine-relations-index/skills/${name}/SKILL.md`, 'utf8'),
      `${host} installed the exact ${name} skill`,
    );
  }
  console.log(`${host}: candidate ${installed.version}, both exact skills installed`);
}

const endpoint = read(join(codex.installedPath, 'mcp.json')).mcpServers['machine-relations-index'].url;
const rpc = async (method, params, id) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.error, undefined, JSON.stringify(body.error));
  return body.result;
};
await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'mr-fresh-install', version: expected.version } }, 1);
const { tools } = await rpc('tools/list', {}, 2);
assert.deepEqual(tools.map((tool) => tool.name).sort(), [
  'mri_get_category',
  'mri_get_cited_sources',
  'mri_get_domain',
  'mri_get_engine',
  'mri_list_categories',
  'mri_list_engines',
]);
const result = await rpc('tools/call', { name: 'mri_list_categories', arguments: {} }, 3);
assert.ok(!result.isError, 'The installed endpoint must answer category discovery');
assert.ok(result.content.some((part) => part.type === 'text' && part.text.length > 0));
console.log('Fresh installed endpoint: initialization, tool schemas and live category discovery passed');
