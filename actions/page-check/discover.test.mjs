import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planDiscovery, previewFromStatus, resolveStatusPreview, responseProvesDeployment, protectionStatus } from './discover.mjs';

const INSPECTOR = 'https://vercel.com/at-725437ca/bramwell-ai/5FcpK5wvrWyZSyPugpysj5v5BrGk';
const ALIAS = 'https://bramwell-ai-git-codeops-vendor-fonts-at-725437ca.vercel.app';
const SHA = '61423645984687c69afa87acb82473ef28ee86b3';
const bot = (state, target = INSPECTOR, context = 'Vercel') => ({ context, state, target_url: target, creator: { login: 'vercel[bot]' } });

test('an authentic inspector status and the pull request branch are the branch alias', () => {
  const plan = planDiscovery({ statuses: [bot('success')], branch: 'codeops/vendor-fonts' });
  assert.equal(plan.action, 'use');
  assert.equal(plan.url, ALIAS);
  assert.equal(plan.limit, 'branch-alias');
  assert.equal(plan.deploymentId, '5FcpK5wvrWyZSyPugpysj5v5BrGk');
});

test('a status whose context says Vercel but whose publisher is not the Vercel app is not a destination', () => {
  const forged = { context: 'Vercel', state: 'success', target_url: 'https://evil.vercel.app', creator: { login: 'octocat' } };
  const plan = planDiscovery({ statuses: [forged], branch: 'codeops/vendor-fonts' });
  assert.equal(plan.action, 'not-a-site');
  assert.equal(plan.url, undefined);
});

test('http, another host, and a vercel.app host we did not derive are not fetched', () => {
  assert.equal(previewFromStatus('http://vercel.com/at-725437ca/bramwell-ai/5FcpK5wvrWyZSyPugpysj5v5BrGk', 'codeops/vendor-fonts').limit, 'insecure');
  assert.equal(previewFromStatus('https://user:pass@vercel.com/at-725437ca/bramwell-ai/5FcpK5wvrWyZSyPugpysj5v5BrGk', 'codeops/vendor-fonts').limit, 'insecure');
  assert.equal(previewFromStatus('https://vercel.com:444/at-725437ca/bramwell-ai/5FcpK5wvrWyZSyPugpysj5v5BrGk', 'codeops/vendor-fonts').limit, 'insecure');
  assert.equal(previewFromStatus('https://evil.example/at-725437ca/bramwell-ai/5FcpK5wvrWyZSyPugpysj5v5BrGk', 'codeops/vendor-fonts').limit, 'unbound-host');
  assert.equal(previewFromStatus('https://evil.vercel.app/path', 'codeops/vendor-fonts').limit, 'unbound-host');
  assert.equal(previewFromStatus('https://bramwell-ai.vercel.app.evil.com/', 'codeops/vendor-fonts').limit, 'unbound-host');
  const plan = planDiscovery({ statuses: [bot('success', 'https://evil.vercel.app/')], branch: 'codeops/vendor-fonts' });
  assert.equal(plan.action, 'no-preview');
  assert.equal(plan.url, undefined);
});

test('an inspector URL without a branch is not a preview address', () => {
  assert.deepEqual(previewFromStatus(INSPECTOR, ''), { url: '', limit: 'no-branch' });
});

test('no deployment record and no authentic Vercel status is not a site and does not wait', async () => {
  let slept = 0;
  const decision = await resolveStatusPreview({
    readStatuses: async () => [{ context: 'Railway', state: 'success', target_url: 'https://example.test', creator: { login: 'railway[bot]' } }],
    branch: 'main',
    sleep: async () => { slept += 1; },
    now: () => 0,
    deadline: 1_000,
  });
  assert.equal(decision.action, 'not-a-site');
  assert.equal(slept, 0);
});

test('a pending authentic status waits until it succeeds, and a deadline ends the wait', async () => {
  let calls = 0;
  const slept = [];
  const ready = await resolveStatusPreview({
    readStatuses: async () => {
      calls += 1;
      return [bot(calls === 1 ? 'pending' : 'success')];
    },
    branch: 'codeops/vendor-fonts',
    sleep: async (ms) => { slept.push(ms); },
    now: () => 0,
    deadline: 1_000,
  });
  assert.equal(ready.action, 'use');
  assert.equal(ready.url, ALIAS);
  assert.deepEqual(slept, [20000]);

  let t = 0;
  const expired = await resolveStatusPreview({
    readStatuses: async () => [bot('pending')],
    branch: 'codeops/vendor-fonts',
    sleep: async () => { t += 20000; },
    now: () => t,
    deadline: 20000,
  });
  assert.deepEqual(expired, { action: 'finished', state: 'pending' });
});

test('a finished failure does not wait, and two successful projects are not guessed', async () => {
  let slept = 0;
  const failed = await resolveStatusPreview({
    readStatuses: async () => [bot('failure')],
    branch: 'codeops/vendor-fonts',
    sleep: async () => { slept += 1; },
    now: () => 0,
    deadline: 1_000,
  });
  assert.equal(failed.action, 'finished');
  assert.equal(failed.state, 'failure');
  assert.equal(slept, 0);
  const several = planDiscovery({
    statuses: [bot('success', INSPECTOR, 'Vercel'), bot('success', 'https://vercel.com/team/other-proj/Abcdefghij1234567890', 'Vercel - other')],
    branch: 'codeops/vendor-fonts',
  });
  assert.equal(several.action, 'no-preview');
  assert.equal(several.limit, 'several-projects');
});

test('a long branch is cut to a 63-character label', () => {
  const found = previewFromStatus(INSPECTOR, `feature/${'VeryLong'.repeat(20)}`);
  assert.equal(found.limit, 'branch-alias');
  const label = new URL(found.url).hostname.split('.')[0];
  assert.ok(label.length <= 63, label);
  assert.match(label, /^bramwell-ai-git-.+-at-725437ca$/);
});

test('a branch alias is this commit only when the response carries the sha or the deployment id', () => {
  const id = '5FcpK5wvrWyZSyPugpysj5v5BrGk';
  assert.equal(responseProvesDeployment({ headers: [], body: `<html>${SHA}</html>`, sha: SHA, deploymentId: id }), true);
  assert.equal(responseProvesDeployment({ headers: [['x-deployment-id', `dpl_${id}`]], body: '', sha: SHA, deploymentId: id }), true);
  assert.equal(responseProvesDeployment({ headers: [], body: '<html>other commit</html>', sha: SHA, deploymentId: id }), false);
  assert.equal(responseProvesDeployment({ headers: [], body: id, sha: SHA, deploymentId: 'short' }), false);
  assert.equal(responseProvesDeployment({ headers: [], body: '', sha: SHA, deploymentId: id }), false);
});

test('a sign-in redirect is protection, and any other redirect is not', () => {
  assert.equal(protectionStatus(401, ''), true);
  assert.equal(protectionStatus(302, 'https://vercel.com/sso-api?url=https%3A%2F%2Fexample.vercel.app'), true);
  assert.equal(protectionStatus(302, 'https://example.vercel.app/somewhere'), false);
  assert.equal(protectionStatus(200, ''), false);
});
