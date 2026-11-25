import assert from 'node:assert/strict';
import test from 'node:test';
import { settleScroll } from './settle.mjs';

// A page in a browser that renders only when asked for a frame. Each frame records the part of the page in view, which is
// all an IntersectionObserver ever sees. With idleNow: false its idle callbacks wait for idle(), as they wait for hydration.
// With smooth: true it is styled html { scroll-behavior: smooth }: a scrollTo without behavior: 'instant' only starts a glide.
function page({ height, viewport = 844, smooth = false, idleNow = true }) {
  const win = { scrollY: 0, innerHeight: viewport, scrolls: 0 };
  const seen = [];
  const waiting = [];
  win.scrollTo = (a, b) => {
    const { top, behavior } = typeof a === 'object' ? a : { top: b, behavior: undefined };
    win.scrolls += 1;
    win.scrollY = !smooth || behavior === 'instant' ? top : win.scrollY + (top - win.scrollY) * 0.1;
  };
  const globals = {
    window: win,
    document: { body: { scrollHeight: height } },
    requestAnimationFrame: (cb) => setTimeout(() => { seen.push([win.scrollY, win.scrollY + win.innerHeight]); cb(); }, 0),
    requestIdleCallback: (cb) => (idleNow ? setTimeout(cb, 0) : waiting.push(cb)),
  };
  return { win, seen, globals, idle: () => waiting.splice(0).forEach((cb) => cb()) };
}

async function inPage(p, run) {
  Object.assign(globalThis, p.globals);
  try {
    return await run();
  } finally {
    for (const k of Object.keys(p.globals)) delete globalThis[k];
  }
}

test('a smooth-scrolling page is back at the top when it is measured', async () => {
  const p = page({ height: 15000, smooth: true });
  await inPage(p, settleScroll);
  assert.equal(p.win.scrollY, 0);
});

test('nothing scrolls until the page has gone idle, so its reveal observers are in place', async () => {
  const p = page({ height: 5000, idleNow: false });
  await inPage(p, async () => {
    const done = settleScroll();
    await new Promise((ok) => setTimeout(ok, 20));
    assert.equal(p.win.scrolls, 0);
    p.idle();
    await done;
  });
  assert.ok(p.win.scrolls > 1);
});

test('every part of the page is rendered in view on the way down', async () => {
  for (const viewport of [844, 768, 1080]) {
    const p = page({ height: 6000, viewport });
    await inPage(p, settleScroll);
    let reach = 0;
    for (const [top, bottom] of p.seen.sort((a, b) => a[0] - b[0])) {
      if (top > reach) break;
      reach = Math.max(reach, bottom);
    }
    assert.ok(reach >= 6000, `viewport ${viewport}: rendered views reach ${reach}px of 6000`);
  }
});

test('the checker settles every render with settleScroll', async () => {
  const fs = await import('node:fs');
  const checker = fs.readFileSync(new URL('./page-check.mjs', import.meta.url), 'utf8');
  assert.match(checker, /page\.evaluate\(settleScroll\)/);
  assert.doesNotMatch(checker, /window\.scrollTo\(0, /);
});
