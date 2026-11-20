// The engine ranking description has to stay the reading getEngine and getEngineCategory publish.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ENGINE_FILTER_CLAIM,
  ENGINE_RANKING,
  engineContractClaims,
  engineDescriptionAgrees,
  openApiOperationDescription,
} from './library.mjs';

const OLD = "An engine's cited-source leaderboard over the observed window, optionally limited to sources with a published segment in a category";
const FALLBACK = 'Older releases without category-by-engine counts instead rank whole-window rates among sources with a published segment in that category.';

test('a category is not a filter on the whole-engine ranking', () => {
  assert.match(OLD, ENGINE_FILTER_CLAIM);
  assert.match('A category is a filter on the whole-engine ranking.', ENGINE_FILTER_CLAIM);
  assert.doesNotMatch(FALLBACK, ENGINE_FILTER_CLAIM);
  assert.doesNotMatch(ENGINE_RANKING.description, ENGINE_FILTER_CLAIM);
  assert.doesNotMatch(ENGINE_RANKING.report, ENGINE_FILTER_CLAIM);
  assert.equal(engineDescriptionAgrees(ENGINE_RANKING.description), true);
  assert.equal(engineDescriptionAgrees(OLD), false);
  assert.equal(engineDescriptionAgrees('With a category, use the whole-engine denominator.'), false);
});

test('the description agrees with the live getEngine and getEngineCategory text', async () => {
  const response = await fetch('https://machinerelations.ai/api/mri/v2/openapi.json', { signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200);
  const document = await response.json();
  const getEngine = openApiOperationDescription(document, 'getEngine');
  const getEngineCategory = openApiOperationDescription(document, 'getEngineCategory');
  const claims = engineContractClaims(getEngine, getEngineCategory);
  for (const [name, ok] of Object.entries(claims)) assert.equal(ok, true, name);
  assert.equal(engineDescriptionAgrees(ENGINE_RANKING.description), true);
  assert.doesNotMatch(getEngine, ENGINE_FILTER_CLAIM);
  assert.doesNotMatch(getEngineCategory, ENGINE_FILTER_CLAIM);
});
