import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

test('the Action runs the runtime beside it, with the same checker arguments', () => {
  const action = readFileSync(path.join(HERE, 'action.yml'), 'utf8');
  assert.match(action, /working-directory: \$\{\{ github\.action_path \}\}\/runtime/);
  assert.match(action, /RUNTIME="\$GITHUB_ACTION_PATH\/runtime"/);
  assert.match(action, /node "\$RUNTIME\/page-check\.mjs" --access "\$GITHUB_ACTION_PATH\/access\.mjs" --changed page-check-changed\.txt --url /);
  assert.match(action, /--base /);
  assert.match(action, /--out page-check-report/);
  assert.doesNotMatch(action, /skills\/page-check\/scripts/);
  const resetAt = action.indexOf('outcome.mjs" --reset page-check-report');
  const runAt = action.indexOf('page-check.mjs');
  assert.ok(resetAt !== -1 && runAt !== -1 && resetAt < runAt);
  for (const name of ['page-check.mjs', 'measure.js', 'words.mjs', 'words.test.mjs', 'package.json', 'package-lock.json']) {
    assert.equal(existsSync(path.join(HERE, 'runtime', name)), true, name);
  }
  const checker = readFileSync(path.join(HERE, 'runtime/page-check.mjs'), 'utf8');
  assert.match(checker, /from '\.\/words\.mjs'/);
  assert.match(checker, /measure\.js/);
  assert.equal(existsSync(path.join(ROOT, 'plugins/machine-relations-index/skills/page-check/scripts')), false);
});
