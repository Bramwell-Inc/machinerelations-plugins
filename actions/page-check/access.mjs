// How the page check gets past Vercel preview protection with no stored secret. It lives with the CI action,
// outside the plugin package, so the skill an agent installs never handles a credential.
// In GitHub Actions it presents the run's own short-lived OIDC token, which each Vercel project accepts
// once GitHub Actions of its org is a Trusted Source for previews. An automation bypass secret, a cookie or a
// share link also work, from the environment. Headers go only to the preview's own host, never to third parties.
const { ACTIONS_ID_TOKEN_REQUEST_URL: REQ_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN: REQ_TOKEN, GITHUB_REPOSITORY_OWNER: OWNER } = process.env;
let cached = { token: '', at: 0 };

async function oidc() {
  if (!REQ_URL || !REQ_TOKEN || !OWNER) return '';
  if (cached.token && Date.now() - cached.at < 4 * 60 * 1000) return cached.token;
  const r = await fetch(`${REQ_URL}&audience=${encodeURIComponent(`https://github.com/${OWNER}`)}`, { headers: { authorization: `Bearer ${REQ_TOKEN}` } });
  if (!r.ok) throw new Error(`GitHub OIDC token request answered ${r.status}`);
  const { value } = await r.json();
  cached = { token: value, at: Date.now() };
  return value;
}

export function previewAccess({ previewUrl, bypass = '', cookie = '' }) {
  const host = new URL(previewUrl).host;
  const fixed = {};
  if (bypass) Object.assign(fixed, { 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' });
  if (cookie) fixed.cookie = cookie;
  const forUrl = async (url) => {
    let h; try { h = new URL(url).host; } catch { return {}; }
    if (h !== host) return {};
    const token = await oidc();
    return token ? { ...fixed, 'x-vercel-trusted-oidc-idp-token': token } : { ...fixed };
  };
  // Playwright: add the headers to preview requests only. Routing turns off the browser cache, so only
  // contexts that load the preview and have something to send get it; production renders stay untouched.
  const sends = () => !!(REQ_URL || fixed['x-vercel-protection-bypass'] || fixed.cookie);
  const attach = async (ctx, root) => {
    if (!sends() || new URL(root).host !== host) return;
    await ctx.route('**/*', async (route) => {
      const req = route.request();
      const extra = await forUrl(req.url());
      if (!Object.keys(extra).length) return route.continue();
      return route.continue({ headers: { ...req.headers(), ...extra } });
    });
  };
  return { forUrl, attach, setCookie: (c) => { fixed.cookie = c; } };
}

// What page-check.mjs loads with --access: the run's identity plus any bypass, cookie or share link from the environment.
export default async function access({ previewUrl }) {
  const env = process.env;
  const a = previewAccess({ previewUrl, bypass: env.VERCEL_AUTOMATION_BYPASS_SECRET || '', cookie: env.PAGE_CHECK_COOKIE || '' });
  // A Vercel share link trades for a session cookie once; every later request carries it.
  if (env.PAGE_CHECK_SHARE) {
    const r = await fetch(`${previewUrl}/?_vercel_share=${env.PAGE_CHECK_SHARE}`, { redirect: 'manual' });
    const jar = (r.headers.getSetCookie?.() || []).map((c) => c.split(';')[0]).join('; ');
    if (jar) a.setCookie(jar); else console.error(`page-check: share link answered ${r.status} with no cookie`);
  }
  return a;
}
