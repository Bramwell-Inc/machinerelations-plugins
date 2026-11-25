// Runs inside the rendered page (Playwright serialises it): scroll through once so lazy content loads, then back to the top.
// Every scroll is instant. A page whose CSS sets scroll-behavior: smooth would otherwise still be gliding back when it is
// measured, and measure.js, which places targets at rect + scrollY, would put a fixed nav over whatever content sits under it.
export async function settleScroll() {
  for (let y = 0; y < document.body.scrollHeight; y += 800) {
    window.scrollTo({ top: y, behavior: 'instant' });
    await new Promise((ok) => setTimeout(ok, 40));
  }
  window.scrollTo({ top: 0, behavior: 'instant' });
}
