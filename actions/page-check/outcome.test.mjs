import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planComment, planFromDir } from './outcome.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CANARY = 'ghp_CANARYPAGESCHECKTOKEN';
const HEAD = {
  clean: '**Page check: clean.**',
  blocking: '**Page check: blocking.**',
  'not-judged': '**Page check: not judged.**',
};

function plan(input) {
  return planComment(input);
}

function assertVerdict(result, verdict) {
  assert.equal(result.verdict, verdict);
  assert.equal(result.fail, verdict === 'blocking');
  assert.match(result.body, new RegExp(`^\\*\\*Page check: ${verdict === 'not-judged' ? 'not judged' : verdict}\\.\\*\\*`));
  for (const [name, headline] of Object.entries(HEAD)) {
    if (name === verdict) continue;
    assert.equal(result.body.includes(headline), false, `a ${verdict} result must not use the ${name} headline`);
  }
  assert.doesNotMatch(result.body, new RegExp(CANARY));
  assert.doesNotMatch(result.body, /Bearer |x-vercel|oidc|ANTHROPIC/i);
  assert.match(result.body, /How the page check works/);
}

test('each resolve skip is not judged and does not fail', () => {
  const cases = [
    ['not-a-site', '', /never deployed this repository/],
    ['preview-protected', '401', /HTTP 401/, /each Vercel project/],
    ['preview-protected', '403', /HTTP 403/],
    ['preview-protected', '', /refused this run/],
    ['preview-protected', `401 ${CANARY}`, /refused this run/],
    ['no-production', '', /production domain/],
    ['deployment-failure', '', /preview is failure/],
    ['deployment-missing', '', /preview is missing/],
    ['deployment-error', '', /preview is error/],
    ['deployment-inactive', '', /preview is inactive/],
    ['deployment-not-a-real-state', '', /was not ready/],
    [`deployment-${CANARY}`, '', /was not ready/],
  ];
  for (const [skip, detail, ...patterns] of cases) {
    const result = plan({ skip, detail, report: null });
    assertVerdict(result, 'not-judged');
    for (const pattern of patterns) assert.match(result.body, pattern, skip);
    assert.doesNotMatch(result.body, /fully enforced|ruleset is Active/i);
  }
});

test('a refused preview does not echo a non-numeric detail', () => {
  const result = plan({ skip: 'preview-protected', detail: CANARY, report: null });
  assertVerdict(result, 'not-judged');
  assert.doesNotMatch(result.reason, /CANARY|ghp_/);
});

test('a missing, unreadable, or unfinished report is not judged', () => {
  for (const report of [undefined, null, {}, { blocking: 'none' }]) {
    const result = plan({ skip: '', report, checkerExit: 2 });
    assertVerdict(result, 'not-judged');
    assert.match(result.body, /exit 2/);
    assert.match(result.body, /pages were not read/);
  }
});

test('a finished report with nothing blocking is clean', () => {
  const result = plan({
    skip: '',
    report: { blocking: [] },
    summary: '**Page check: clean.** 12 pages read.\n\nA note.',
  });
  assertVerdict(result, 'clean');
  assert.match(result.body, /12 pages read/);
  assert.match(result.body, /A note/);
});

test('blocking findings fail even when a skip flag is also set', () => {
  const report = { blocking: [{ kind: 'contrast', detail: 'quiet grey' }] };
  const alone = plan({ skip: '', report, summary: '**Page check: blocking.** 1 problem.\n\n- contrast' });
  assertVerdict(alone, 'blocking');
  assert.match(alone.body, /contrast/);
  const withSkip = plan({ skip: 'preview-protected', detail: '401', report, summary: '**Page check: clean.** 12 pages read.' });
  assertVerdict(withSkip, 'blocking');
  assert.match(withSkip.body, /12 pages read/);
});

test('a contradictory summary headline follows the report', () => {
  const result = plan({
    skip: '',
    report: { blocking: [] },
    summary: '**Page check: blocking.** this headline is stale\n\n12 pages read.',
  });
  assertVerdict(result, 'clean');
  assert.match(result.body, /12 pages read/);
});

test('gate and comment stay quiet about credentials and fail only on defects', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'page-check-'));
  writeFileSync(path.join(dir, 'summary.md'), `**Page check: clean.** token ${CANARY}`);
  const env = { ...process.env, GITHUB_TOKEN: CANARY, SKIP: 'not-a-site', SKIP_DETAIL: '', CHECKER_EXIT: '', PR: '', GITHUB_REPOSITORY: '', GITHUB_STEP_SUMMARY: '' };
  const fromDisk = planFromDir(dir, env);
  assertVerdict(fromDisk, 'not-judged');
  const gate = spawnSync(process.execPath, [path.join(HERE, 'gate.mjs'), dir], { env, encoding: 'utf8' });
  assert.equal(gate.status, 0);
  assert.match(gate.stdout, /not judged/);
  assert.doesNotMatch(`${gate.stdout}${gate.stderr}`, /CANARY/);
  const comment = spawnSync(process.execPath, [path.join(HERE, 'comment.mjs'), dir], { env, encoding: 'utf8' });
  assert.equal(comment.status, 0);
  assert.match(comment.stdout, /not judged/);
  assert.doesNotMatch(`${comment.stdout}${comment.stderr}`, /CANARY/);

  writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ blocking: [{ kind: 'raw-value' }] }));
  writeFileSync(path.join(dir, 'summary.md'), '**Page check: blocking.** one raw value');
  const blockingEnv = { ...env, SKIP: '' };
  const failed = spawnSync(process.execPath, [path.join(HERE, 'gate.mjs'), dir], { env: blockingEnv, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /blocking/);
  assert.doesNotMatch(`${failed.stdout}${failed.stderr}`, /CANARY/);
});

test('the action fails the job only through the gate, and taste still needs a finished report', () => {
  const action = readFileSync(path.join(HERE, 'action.yml'), 'utf8');
  assert.match(action, /gate\.mjs/);
  assert.match(action, /comment\.mjs/);
  assert.doesNotMatch(action, /draft/);
  assert.doesNotMatch(action, /\bexit 1\b/);
  assert.match(action, /hashFiles\('page-check-report\/report\.json'\) != ''/);
});
