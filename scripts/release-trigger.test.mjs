import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { shouldPublish } from './release-trigger.mjs';

const script = fileURLToPath(new URL('./release-trigger.mjs', import.meta.url));

function run(repo, event, ref) {
  const output = join(repo, 'output.txt');
  const result = spawnSync(process.execPath, [script], {
    cwd: repo,
    env: { ...process.env, RELEASE_EVENT: event, RELEASE_REF: ref, GITHUB_OUTPUT: output },
    encoding: 'utf8',
  });
  return { result, line: readFileSync(output, 'utf8').trim(), stdout: result.stdout };
}

function repoWith(versions) {
  const repo = mkdtempSync(join(tmpdir(), 'release-trigger-'));
  const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
  git(['init', '-b', 'main']);
  git(['config', 'user.email', 'release-trigger@example.com']);
  git(['config', 'user.name', 'release-trigger']);
  const manifest = join(repo, 'plugins/machine-relations-index');
  mkdirSync(manifest, { recursive: true });
  versions.forEach((version, index) => {
    writeFileSync(join(manifest, 'plugin.json'), JSON.stringify({ version, commit: index }));
    git(['add', 'plugins/machine-relations-index/plugin.json']);
    git(['commit', '-m', version]);
  });
  return repo;
}

test('the publisher runs only for a push to main that changes the package version', () => {
  assert.equal(shouldPublish({ event: 'push', ref: 'refs/heads/main', previousVersion: '1.2.2', currentVersion: '1.2.3' }), true);
  assert.equal(shouldPublish({ event: 'push', ref: 'refs/heads/main', previousVersion: '1.2.3', currentVersion: '1.2.3' }), false);
  assert.equal(shouldPublish({ event: 'workflow_dispatch', ref: 'refs/heads/main', previousVersion: '1.2.2', currentVersion: '1.2.3' }), false);
  assert.equal(shouldPublish({ event: 'pull_request', ref: 'refs/heads/main', previousVersion: '1.2.2', currentVersion: '1.2.3' }), false);
  assert.equal(shouldPublish({ event: 'push', ref: 'refs/heads/cursor/zenodo-draft-recover-2501', previousVersion: '1.2.2', currentVersion: '1.2.3' }), false);
  assert.equal(shouldPublish({ event: 'push', ref: 'refs/heads/main', previousVersion: null, currentVersion: '1.2.3' }), false);
});

test('a same-version commit on main does not ask the workflow to publish', () => {
  const same = run(repoWith(['1.2.3', '1.2.3']), 'push', 'refs/heads/main');
  assert.equal(same.result.status, 0);
  assert.equal(same.line, 'publish=false');
  assert.match(same.stdout, /"publish":false/);
  const bumped = run(repoWith(['1.2.2', '1.2.3']), 'push', 'refs/heads/main');
  assert.equal(bumped.line, 'publish=true');
  const dispatch = run(repoWith(['1.2.2', '1.2.3']), 'workflow_dispatch', 'refs/heads/main');
  assert.equal(dispatch.line, 'publish=false');
});
