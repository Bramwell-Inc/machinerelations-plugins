import assert from 'node:assert/strict';
import test from 'node:test';
import { scanWords } from './words.mjs';

const kinds = (t, hard = true) => scanWords(t).filter((f) => f.hard === hard).map((f) => `${f.kind}:${f.match}`);

test('values that leaked into copy block', () => {
  assert.deepEqual(kinds('Cited by null sources.'), ['raw-value:null']);
  assert.deepEqual(kinds('Category: [object Object]'), ['raw-value:[object Object]']);
  assert.deepEqual(kinds('Welcome back, {{ firstName }}'), ['raw-value:{{ firstName }}']);
  assert.deepEqual(kinds('Release 3f2a9c1e-77b0-4a8e-9d1c-0a1b2c3d4e5f'), ['raw-id:3f2a9c1e-77b0-4a8e-9d1c-0a1b2c3d4e5f']);
  assert.deepEqual(kinds('Seen in 1 answers'), ['bad-plural:1 answers']);
  assert.deepEqual(kinds('Release mri_score_v2.1+2026-11-05+66c560c07279 covers the window'), ['raw-id:mri_score_v2.1+2026-11-05+66c560c07279']);
  assert.deepEqual(kinds('Cited in 1 of the 1 months since.'), ['bad-plural:1 months']);
  assert.deepEqual(kinds('By the Numbers [object Object] [object Object]').length, 2);
  assert.deepEqual(kinds('the emerging discipline of earning cita null AEO and GEO'), ['raw-value:null']);
  assert.deepEqual(kinds('Status: release_unavailable for this category.'), ['raw-id:release_unavailable']);
  assert.deepEqual(kinds('Methodology mri_score_v2.0. Then file_name.pdf and a@b_c.com.'), ['raw-id:mri_score_v2.0']);
});

test('ordinary prose and prose about code pass', () => {
  assert.deepEqual(kinds('The `next_cursor` field is null on the last page.'), []);
  assert.deepEqual(kinds('1 analysis, 1 bus, 1 news, null-safe, nullable'), []);
  assert.deepEqual(kinds('Seen in 1 answer from 3 engines.'), []);
  assert.deepEqual(kinds('A leader is null when no ranking is published. null means no context. Missing or null context.'), []);
  assert.deepEqual(kinds('Tier 1 publications, Tier-1 placements 13, reaching rank 1 separates nothing, Step 1 means this. Layer 1 remains, the #1 slots, June 1 means. Ontology 1 shifts search.'), []);
  assert.deepEqual(kinds('Signals rise above null conditions and a null baseline; the null hypothesis holds, audit-first null calibration.'), []);
  assert.deepEqual(kinds('Tag links with utm_source so referrals show; the search_paralax_articles tool and best_x questions.'), []);
  assert.deepEqual(kinds('Write to first_last@example.com or read the `next_cursor` field.'), []);
  assert.deepEqual(kinds('See globenewswire.com/NewsRoom/AttachmentNg/b906ef82-3f51-4b53-a1da-ddb4b1c97da9 for the file.'), []);
  assert.deepEqual(kinds('Read [auth.md](${SITE_ORIGIN}/auth.md).'), ['raw-value:${SITE_ORIGIN}']);
  assert.deepEqual(kinds('Any other release returns 409 release_unavailable; unknown categories return 404 unknown_category.'), []);
});

test('judgment calls are notes, never blockers', () => {
  assert.deepEqual(kinds('Cited 0.00% of the time by Strac.io', false), ['zero-rate:0.00%', 'domain-case:Strac.io']);
});
