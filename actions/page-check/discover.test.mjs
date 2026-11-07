import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasVercelDeployment, previewFromStatus, vercelStatus } from './discover.mjs';

const INSPECTOR = 'https://vercel.com/at-725437ca/bramwell-ai/5FcpK5wvrWyZSyPugpysj5v5BrGk';
const ALIAS = 'https://bramwell-ai-git-codeops-vendor-fonts-at-725437ca.vercel.app';

test('a linked project with no GitHub deployment record is still a preview, via the Vercel status', () => {
  assert.equal(hasVercelDeployment([]), false);
  const status = vercelStatus([
    { context: 'Vercel', state: 'success', target_url: INSPECTOR },
  ]);
  assert.equal(status.state, 'success');
  assert.deepEqual(previewFromStatus(status.target_url, 'codeops/vendor-fonts'), { url: ALIAS, limit: 'branch-alias' });
});

test('a status that already names a vercel.app host is that host, not a derived alias', () => {
  assert.deepEqual(
    previewFromStatus('https://example-git-main-team.vercel.app/path', 'other'),
    { url: 'https://example-git-main-team.vercel.app', limit: 'status-host' },
  );
});

test('an inspector URL without a branch is not a preview address', () => {
  assert.deepEqual(previewFromStatus(INSPECTOR, ''), { url: '', limit: 'no-branch' });
});

test('no deployment record and no Vercel status is not a site', () => {
  assert.equal(hasVercelDeployment([{ creator: { login: 'github-actions[bot]' } }]), false);
  assert.equal(vercelStatus([]), null);
  assert.equal(vercelStatus([{ context: 'Railway', state: 'success', target_url: 'https://example.test' }]), null);
});

test('a Vercel deployment record is preferred over the absence test', () => {
  assert.equal(hasVercelDeployment([{ creator: { login: 'vercel[bot]' } }]), true);
});

test('a long branch is cut to a 63-character label and still derived, not hardcoded', () => {
  const found = previewFromStatus(INSPECTOR, `feature/${'VeryLong'.repeat(20)}`);
  assert.equal(found.limit, 'branch-alias');
  const label = new URL(found.url).hostname.split('.')[0];
  assert.ok(label.length <= 63, label);
  assert.match(label, /^bramwell-ai-git-.+-at-725437ca$/);
});
