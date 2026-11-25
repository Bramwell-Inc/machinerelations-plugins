import assert from 'node:assert/strict';
import test from 'node:test';
import { settleScroll } from './settle.mjs';

// A page styled html { scroll-behavior: smooth }: a scrollTo without behavior: 'instant' only starts a glide,
// so scrollY is still far from its target when the next line runs.
function smoothPage(height) {
  const win = { scrollY: 0 };
  win.scrollTo = (a, b) => {
    const { top, behavior } = typeof a === 'object' ? a : { top: b, behavior: undefined };
    win.scrollY = behavior === 'instant' ? top : win.scrollY + (top - win.scrollY) * 0.1;
  };
  return { window: win, document: { body: { scrollHeight: height } } };
}

test('a smooth-scrolling page is back at the top when it is measured', async () => {
  const page = smoothPage(15000);
  Object.assign(globalThis, page);
  try {
    await settleScroll();
    assert.equal(page.window.scrollY, 0);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});

test('the checker settles every render with settleScroll', async () => {
  const fs = await import('node:fs');
  const checker = fs.readFileSync(new URL('./page-check.mjs', import.meta.url), 'utf8');
  assert.match(checker, /page\.evaluate\(settleScroll\)/);
  assert.doesNotMatch(checker, /window\.scrollTo\(0, /);
});
