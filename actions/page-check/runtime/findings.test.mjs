import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signature } from './findings.mjs';

const contrast = { kind: 'contrast', pair: '#999999 on #ffffff', where: 'p "Old copy"', detail: '1 text element(s) at 2.85:1; needs 4.5:1' };
const page = (path, view = 'wide', type = '/blog/*') => ({ path, type, view });
const keys = (rows) => new Set(rows.flatMap((r) => r.defects.map((d) => signature(d, r))));

for (const d of [contrast, { kind: 'small-text', where: 'p "Copy"', detail: '10px text' }, { kind: 'clipped-text', where: 'h1 "Copy"', detail: '2px clipped' }]) {
  test(`${d.kind}: production's defect on page A never excuses page B`, () => {
    const baseline = keys([{ ...page('/blog/a'), defects: [d] }]);
    assert.equal(baseline.has(signature(d, page('/blog/a'))), true);
    assert.equal(baseline.has(signature(d, page('/blog/b'))), false);
  });
}

test('contrast: the repeated-render decision stays bound to the suspect page', () => {
  const suspect = { ...contrast, ...page('/blog/b') };
  const again = keys([{ ...page('/blog/a'), defects: [] }, { ...page('/blog/b'), defects: [contrast] }]);
  const onBase = keys([{ ...page('/blog/a'), defects: [contrast] }, { ...page('/blog/b'), defects: [] }]);
  const k = signature(suspect, suspect);
  assert.equal(again.has(k), true, 'same-page preview recurrence is real');
  assert.equal(onBase.has(k), false, 'another production page is not evidence this defect existed');
});

test('contrast: a finding repeated only on another page is not confirmed', () => {
  const again = keys([{ ...page('/blog/a'), defects: [contrast] }, { ...page('/blog/b'), defects: [] }]);
  assert.equal(again.has(signature(contrast, page('/blog/b'))), false);
});

test('same-page contrast uses the pair, not changing first-element copy', () => {
  assert.equal(signature(contrast, page('/blog/a')), signature({ ...contrast, where: 'span "New copy"', detail: '4 text elements' }, page('/blog/a')));
  assert.notEqual(signature(contrast, page('/blog/a')), signature({ ...contrast, pair: '#aaaaaa on #ffffff' }, page('/blog/a')));
});

test('same-page baseline does not leak across viewport or page type', () => {
  assert.notEqual(signature(contrast, page('/blog/a')), signature(contrast, page('/blog/a', 'phone')));
  assert.notEqual(signature(contrast, page('/blog/a')), signature(contrast, page('/blog/a', 'wide', '/other/*')));
});

test('machine findings keep their own URL and non-numeric detail identity without rendered scope', () => {
  const d = { kind: 'http', where: '/blog/a', detail: 'HTTP 404' };
  assert.equal(signature(d), signature({ ...d, detail: 'HTTP 500' }));
  assert.notEqual(signature(d), signature({ ...d, where: '/blog/b' }));
  assert.notEqual(signature(d), signature({ ...d, detail: 'missing canonical' }));
});
