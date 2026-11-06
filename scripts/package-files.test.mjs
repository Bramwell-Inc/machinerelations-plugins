import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listPackageFiles, packageFileAllowed, rejectedPackageFiles } from './package-files.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the packaged tree and the zip stay inside the directory file types', () => {
  const files = listPackageFiles(path.join(ROOT, 'plugins/machine-relations-index'));
  assert.deepEqual(rejectedPackageFiles(files), []);
  assert.ok(files.includes('skills/page-check/SKILL.md'));
  assert.equal(files.some((file) => file.startsWith('skills/page-check/scripts/')), false);
  const dir = mkdtempSync(path.join(tmpdir(), 'mr-package-'));
  try {
    const zip = path.join(dir, 'machine-relations-index.zip');
    execFileSync('zip', ['-qrX', zip, '.'], { cwd: path.join(ROOT, 'plugins/machine-relations-index') });
    const names = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' })
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.endsWith('/'));
    assert.deepEqual(rejectedPackageFiles(names), []);
    assert.equal(names.some((name) => name.endsWith('.mjs') || name.endsWith('.js')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a future executable under the package is rejected before a directory scan', () => {
  for (const file of ['skills/next/scripts/run.mjs', 'skills/next/tool.js', 'bin/fetch.sh', 'payload.py', 'page.html']) {
    assert.equal(packageFileAllowed(file), false, file);
  }
  for (const file of ['LICENSE', 'README', '.gitignore', 'icon', 'notes.md', 'data.json', 'skill.yaml', 'mark.yml', 'assets/icon.png']) {
    assert.equal(packageFileAllowed(file), true, file);
  }
  assert.deepEqual(rejectedPackageFiles(['LICENSE', 'skills/page-check/scripts/page-check.mjs']), ['skills/page-check/scripts/page-check.mjs']);
});

test('installed skill text names the public runtime and does not carry the program', () => {
  const skill = readFileSync(path.join(ROOT, 'plugins/machine-relations-index/skills/page-check/SKILL.md'), 'utf8');
  const readme = readFileSync(path.join(ROOT, 'plugins/machine-relations-index/README.md'), 'utf8');
  assert.match(skill, /actions\/page-check\/runtime/);
  assert.match(skill, /actions\/page-check/);
  assert.doesNotMatch(skill, /scripts\/` next to this file|cd <this skill folder>\/scripts/);
  assert.doesNotMatch(`${skill}\n${readme}`, /\bcurl\b|\bwget\b|\beval\b|base64 -d/);
  const packaged = listPackageFiles(path.join(ROOT, 'plugins/machine-relations-index'))
    .filter((file) => /\.(md|json|ya?ml|txt)$/.test(file));
  for (const file of packaged) {
    const text = readFileSync(path.join(ROOT, 'plugins/machine-relations-index', file), 'utf8');
    assert.doesNotMatch(text, /from ['"]node:|require\(['"]playwright|@axe-core\/playwright/, `${file} embeds checker code`);
  }
  const workflow = readFileSync(path.join(ROOT, '.github/workflows/package.yml'), 'utf8');
  assert.match(workflow, /find scripts actions -name '\*\.test\.mjs'/);
  assert.doesNotMatch(workflow, /skills\/\*\/scripts/);
});
