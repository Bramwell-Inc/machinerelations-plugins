import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planComment, planFromDir, resetOutDir } from './outcome.mjs';

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

test('a finished report with nothing blocking is clean only when this run exited 0', () => {
  const result = plan({
    skip: '',
    checkerExit: 0,
    report: { blocking: [] },
    summary: '**Page check: clean.** 12 pages read.\n\nA note.',
  });
  assertVerdict(result, 'clean');
  assert.match(result.body, /12 pages read/);
  assert.match(result.body, /A note/);
  const unfinished = plan({ skip: '', checkerExit: 2, report: { blocking: [] }, summary: '**Page check: clean.** stale' });
  assertVerdict(unfinished, 'not-judged');
  assert.match(unfinished.body, /exit 2/);
  assert.match(unfinished.body, /not a clean result/);
  assert.equal(unfinished.fail, false);
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
    checkerExit: 0,
    report: { blocking: [] },
    summary: '**Page check: blocking.** this headline is stale\n\n12 pages read.',
  });
  assertVerdict(result, 'clean');
  assert.match(result.body, /12 pages read/);
});

test('a stale empty report plus a crash is not judged, and blocking findings still fail', () => {
  const stale = plan({ skip: '', checkerExit: 2, report: { blocking: [] } });
  assertVerdict(stale, 'not-judged');
  assert.equal(stale.fail, false);
  const defects = plan({
    skip: '',
    checkerExit: 2,
    report: { blocking: [{ kind: 'contrast' }] },
    summary: '**Page check: blocking.** contrast',
  });
  assertVerdict(defects, 'blocking');
  const finishedDefects = plan({
    skip: '',
    checkerExit: 1,
    report: { blocking: [{ kind: 'contrast' }] },
    summary: '**Page check: blocking.** contrast',
  });
  assertVerdict(finishedDefects, 'blocking');
  const dir = mkdtempSync(path.join(tmpdir(), 'page-check-stale-'));
  writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ blocking: [] }));
  writeFileSync(path.join(dir, 'summary.md'), '**Page check: clean.** stale pages');
  const env = { ...process.env, SKIP: '', SKIP_DETAIL: '', CHECKER_EXIT: '2', GITHUB_TOKEN: CANARY, PR: '', GITHUB_REPOSITORY: '', GITHUB_STEP_SUMMARY: '' };
  const comment = spawnSync(process.execPath, [path.join(HERE, 'comment.mjs'), dir], { env, encoding: 'utf8' });
  assert.equal(comment.status, 0);
  assert.match(comment.stdout, /\*\*Page check: not judged\.\*\*/);
  assert.doesNotMatch(comment.stdout, /\*\*Page check: clean\.\*\*/);
  assert.doesNotMatch(`${comment.stdout}${comment.stderr}`, /CANARY/);
  const gate = spawnSync(process.execPath, [path.join(HERE, 'gate.mjs'), dir], { env, encoding: 'utf8' });
  assert.equal(gate.status, 0);
  assert.match(gate.stdout, /not judged/);
});

test('a missing or unreadable report stays not judged when the checker exited 0', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'page-check-bad-'));
  writeFileSync(path.join(dir, 'report.json'), '{');
  const env = { ...process.env, SKIP: '', SKIP_DETAIL: '', CHECKER_EXIT: '0', GITHUB_TOKEN: CANARY, PR: '', GITHUB_REPOSITORY: '', GITHUB_STEP_SUMMARY: '' };
  const unread = planFromDir(dir, env);
  assertVerdict(unread, 'not-judged');
  assert.equal(unread.fail, false);
  const gate = spawnSync(process.execPath, [path.join(HERE, 'gate.mjs'), dir], { env, encoding: 'utf8' });
  assert.equal(gate.status, 0);
  assert.match(gate.stdout, /not judged/);
  assert.doesNotMatch(`${gate.stdout}${gate.stderr}`, /CANARY/);
});

test('resetOutDir removes a stale report before the checker runs', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'page-check-reset-'));
  const out = path.join(dir, 'page-check-report');
  mkdirSync(out);
  writeFileSync(path.join(out, 'report.json'), JSON.stringify({ blocking: [] }));
  const cli = spawnSync(process.execPath, [path.join(HERE, 'outcome.mjs'), '--reset', out], { encoding: 'utf8' });
  assert.equal(cli.status, 0);
  assert.equal(existsSync(path.join(out, 'report.json')), false);
  assert.throws(() => resetOutDir(''), /refusing to clear/);
  const action = readFileSync(path.join(HERE, 'action.yml'), 'utf8');
  const resetAt = action.indexOf('outcome.mjs" --reset page-check-report');
  const runAt = action.indexOf('page-check.mjs');
  assert.ok(resetAt !== -1 && runAt !== -1 && resetAt < runAt);
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
