// The site's own links, read on the deployment under check.
const SKIP = /\.(png|jpe?g|svg|webp|ico|xml|txt|json|md|pdf|css|js)$/i;

// Whether a link's redirects hand off to another site. Asked only when following the link failed outright:
// fetch then gives no final URL, so a hand-off to a site Node's fetch cannot read (Gemini's headers overflow
// undici's limit) would otherwise read as our broken link. `request` is one fetch with redirect: 'manual'.
export async function leavesSite(url, origin, request) {
  for (let hop = 0; hop < 10; hop += 1) {
    const res = await request(url).catch(() => null);
    const location = res && res.status >= 300 && res.status < 400 && res.headers.get('location');
    await res?.body?.cancel();
    if (!location) return false;
    const next = new URL(location, url);
    if (next.origin !== origin) return true;
    url = next.href;
  }
  return false;
}

// `get` follows redirects and answers { status, url } or { status: 0, error }.
export async function checkLinks(root, pages, { get, request }) {
  const origin = new URL(root).origin;
  const defects = []; const all = new Set();
  for (const pg of pages) for (const m of (pg.html || '').matchAll(/href=["'](\/[^"'#?]*)/g)) all.add(m[1]);
  const list = [...all].filter((p) => !SKIP.test(p) && !p.startsWith('/_next')).slice(0, 150);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (list.length) {
      const p = list.shift();
      const r = await get(root + p);
      // A link that hands off to another site (a redirect out) is that site's to answer; a rate limit is not a broken page.
      const offsite = r.url ? new URL(r.url).origin !== origin : r.status === 0 && await leavesSite(root + p, origin, request);
      if (!offsite && (r.status === 0 || (r.status >= 400 && r.status !== 429))) defects.push({ kind: 'broken-link', detail: `${p} answered ${r.status || r.error}`, where: p });
    }
  }));
  return { defects, checked: all.size };
}
