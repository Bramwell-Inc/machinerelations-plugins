import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEBSITE_CALLER = 'AuthorityTech/website/.github/workflows/page-check.yml';

function assertCallerRunsOnDrafts(yaml, label) {
  assert.doesNotMatch(yaml, /draft\s*==\s*false/, `${label} skips draft pull requests`);
  assert.doesNotMatch(yaml, /pull_request\.draft/, `${label} branches on the draft flag`);
  assert.match(yaml, /pull_request:/, `${label} does not run on pull_request`);
  assert.match(yaml, /opened,\s*synchronize,\s*reopened/, `${label} does not run when a draft is opened or updated`);
}

function assertCallerCanReadCommitStatuses(yaml, label) {
  const block = yaml.match(/^permissions:\n(?:[ \t].*\n)*/m);
  assert.ok(block, `${label} does not set token permissions`);
  assert.match(block[0], /^[ \t]+statuses:[ \t]+read[ \t]*$/m, `${label} does not grant statuses: read`);
  assert.doesNotMatch(block[0], /statuses:[ \t]+write/, `${label} grants statuses write`);
  assert.match(block[0], /^[ \t]+contents:[ \t]+read[ \t]*$/m);
  assert.match(block[0], /^[ \t]+pull-requests:[ \t]+write[ \t]*$/m);
  assert.match(block[0], /^[ \t]+deployments:[ \t]+read[ \t]*$/m);
  assert.match(block[0], /^[ \t]+id-token:[ \t]+write[ \t]*$/m);
  const writes = [...block[0].matchAll(/^[ \t]+([a-z-]+):[ \t]+write[ \t]*$/gm)].map((match) => match[1]).sort();
  assert.deepEqual(writes, ['id-token', 'pull-requests'], `${label} write scopes changed`);
}

test('this repository caller runs on draft heads', () => {
  const yaml = readFileSync(path.join(ROOT, '.github/workflows/page-check.yml'), 'utf8');
  assertCallerRunsOnDrafts(yaml, 'Bramwell-Inc/machinerelations-plugins');
  assertCallerCanReadCommitStatuses(yaml, 'Bramwell-Inc/machinerelations-plugins');
  assert.match(yaml, /if:\s*github\.repository\s*!=\s*'Bramwell-Inc\/machinerelations-plugins'/);
  assert.match(yaml, /not judged/);
  assert.doesNotMatch(yaml, /passes untouched/);
});

test('AuthorityTech website caller is not vendored here', () => {
  const local = readFileSync(path.join(ROOT, '.github/workflows/page-check.yml'), 'utf8');
  assert.doesNotMatch(local, /AuthorityTech\/website/);
  assert.throws(() => readFileSync(path.join(ROOT, 'fixtures/website-page-check.yml'), 'utf8'));
  const doc = readFileSync(path.join(ROOT, 'plugins/machine-relations-index/skills/page-check/references/how-it-works.md'), 'utf8');
  assert.match(doc, /AuthorityTech keeps its own copy/);
  assert.match(doc, /not coverage of it/);
  assert.match(doc, /counts a skipped Page check as passed/);
  assert.doesNotMatch(doc, /has to treat a skipped|Until those gates require/);
});

test('AuthorityTech website caller runs on drafts when this environment can read it', (t) => {
  const remote = spawnSync('gh', [
    'api', `repos/${WEBSITE_CALLER.split('/').slice(0, 2).join('/')}/contents/${WEBSITE_CALLER.split('/').slice(2).join('/')}`,
    '-H', 'Accept: application/vnd.github.raw',
  ], { encoding: 'utf8' });
  if (remote.status !== 0) {
    t.skip(`${WEBSITE_CALLER} is not readable here (${(remote.stderr || '').trim().slice(0, 180) || remote.status}). This is not coverage of that caller.`);
    return;
  }
  assertCallerRunsOnDrafts(remote.stdout, WEBSITE_CALLER);
  assertCallerCanReadCommitStatuses(remote.stdout, WEBSITE_CALLER);
});
