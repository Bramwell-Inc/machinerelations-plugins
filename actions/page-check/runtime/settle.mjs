// Runs inside the rendered page (Playwright serialises it): scroll through once so lazy content loads, then back to the top.
// A section that fades in on entering the viewport is revealed by an observer the page registers once hydrated, and that
// observer sees only positions the browser rendered. Timed 800px jumps outran both, so two renders of one unchanged page
// disagreed about which sections showed. It waits for the page to go idle, then moves half a screen at a time and lets two
// frames render at every stop, each wait capped so a page that never idles or paints still settles.
// Every scroll is instant. A page whose CSS sets scroll-behavior: smooth would otherwise still be gliding back when it is
// measured, and measure.js, which places targets at rect + scrollY, would put a fixed nav over whatever content sits under it.
export async function settleScroll() {
  const rendered = () => new Promise((ok) => {
    const cap = setTimeout(ok, 1000);
    requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(cap); ok(); }));
  });
  await new Promise((ok) => requestIdleCallback(ok, { timeout: 5000 }));
  const step = Math.max(200, Math.floor(window.innerHeight / 2));
  for (let y = 0; y < document.body.scrollHeight; y += step) {
    window.scrollTo({ top: y, behavior: 'instant' });
    await rendered();
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
