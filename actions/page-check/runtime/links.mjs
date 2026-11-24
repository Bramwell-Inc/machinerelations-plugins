// The site's own links, read on the deployment under check.
const SKIP = /\.(png|jpe?g|svg|webp|ico|xml|txt|json|md|pdf|css|js)$/i;

// How the check reads a URL. It follows redirects itself, so forUrl's access headers reach each hop's own host only:
// fetch's own redirect: 'follow' carries them, the run's OIDC token included, to whatever site a link hands off to.
// It answers { status, type, body, url } or { status: 0, error, url }, `url` being where the read ended or failed.
// A hand-off to a site Node cannot read (Gemini's headers overflow undici's limit) so fails there, not on our host.
export function reader(forUrl, ua, request = fetch) {
  return async function get(url, extra = {}) {
    let at = url;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      at = url;
      try {
        for (let hop = 0; hop < 20; hop += 1) {
          const res = await request(at, { headers: { 'user-agent': ua, ...(await forUrl(at)), ...extra }, redirect: 'manual', signal: AbortSignal.timeout(20000) });
          const location = res.status >= 300 && res.status < 400 && res.headers.get('location');
          if (!location) return { status: res.status, type: res.headers.get('content-type') || '', body: await res.text(), url: at };
          await res.body?.cancel();
          at = new URL(location, at).href;
        }
        throw new Error('redirect count exceeded');
      } catch (e) { if (attempt === 2) return { status: 0, type: '', body: '', error: String(e.message || e), url: at }; }
    }
  };
}

// `get` is a reader (above).
export async function checkLinks(root, pages, { get }) {
  const origin = new URL(root).origin;
  const defects = []; const all = new Set();
  for (const pg of pages) for (const m of (pg.html || '').matchAll(/href=["'](\/[^"'#?]*)/g)) all.add(m[1]);
  const list = [...all].filter((p) => !SKIP.test(p) && !p.startsWith('/_next')).slice(0, 150);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (list.length) {
      const p = list.shift();
      const r = await get(root + p);
      // A link that hands off to another site (a redirect out) is that site's to answer; a rate limit is not a broken page.
      const offsite = new URL(r.url).origin !== origin;
      if (!offsite && (r.status === 0 || (r.status >= 400 && r.status !== 429))) defects.push({ kind: 'broken-link', detail: `${p} answered ${r.status || r.error}`, where: p });
    }
  }));
  return { defects, checked: all.size };
}
