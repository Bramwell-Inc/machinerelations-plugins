// How a commit's Vercel preview is found with only the GitHub token the Action already has.
// A GitHub deployment record is the pinned address. Some linked projects never write one and only
// post a commit status. That status is accepted only from the Vercel GitHub app (vercel[bot]),
// only over HTTPS, and the host we will ask for is the one derived from that status's inspector
// URL (team, project, and the pull request branch). A host named by anyone else, an http URL, or
// some other *.vercel.app host is not a destination, so the job's OIDC token is not sent there.
// The derived host is the branch alias the deployment records, not a hostname guessed from the
// deployment id. A clean or blocking verdict is allowed only when the document element carries
// data-dpl-id for that exact deployment. Text elsewhere in the page does not count.
// No Vercel token is read or required.

const BOT = 'vercel[bot]';
const BOT_ID = 35613825;

export function hasVercelDeployment(deployments) {
  return Array.isArray(deployments) && deployments.some((d) => String(d?.creator?.login || '').startsWith('vercel'));
}

export function branchSlug(branch) {
  return String(branch || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// {project}-git-{branch}-{team}.vercel.app. A DNS label is at most 63 characters; the branch is what is cut.
export function branchPreviewUrl(team, project, branch) {
  if (!/^[a-z0-9-]+$/.test(team) || !/^[a-z0-9-]+$/.test(project)) return '';
  const slug = branchSlug(branch);
  if (!slug) return '';
  const prefix = `${project}-git-`;
  const suffix = `-${team}`;
  const room = 63 - prefix.length - suffix.length;
  if (room < 1) return '';
  const cut = slug.slice(0, room).replace(/-+$/g, '');
  if (!cut) return '';
  return `https://${prefix}${cut}${suffix}.vercel.app`;
}

export function authenticVercelStatuses(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  return list.filter((s) => s?.creator?.login === BOT && Number(s.creator.id) === BOT_ID && /^Vercel\b/.test(String(s.context || '')));
}

// The statuses list keeps older rows for the same context. The latest row per context is the state.
export function latestAuthenticStatuses(statuses) {
  const ranked = authenticVercelStatuses(statuses).map((status, index) => {
    const stamp = Date.parse(status.created_at || status.updated_at || '');
    return { status, index, stamp: Number.isFinite(stamp) ? stamp : 0 };
  });
  ranked.sort((a, b) => b.stamp - a.stamp || a.index - b.index);
  const seen = new Set();
  const latest = [];
  for (const row of ranked) {
    const key = String(row.status.context || '');
    if (seen.has(key)) continue;
    seen.add(key);
    latest.push(row.status);
  }
  return latest;
}

export function previewFromStatus(targetUrl, branch) {
  let url;
  try {
    url = new URL(String(targetUrl || ''));
  } catch {
    return { url: '', limit: 'unrecognized' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return { url: '', limit: 'insecure' };
  if (url.hostname !== 'vercel.com') return { url: '', limit: 'unbound-host' };
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length !== 3) return { url: '', limit: 'unrecognized' };
  const [team, project, deploymentId] = parts;
  if (!/^[A-Za-z0-9]{8,}$/.test(deploymentId)) return { url: '', limit: 'unrecognized' };
  const alias = branchPreviewUrl(team, project, branch);
  if (!alias) return { url: '', limit: branch ? 'alias-too-long' : 'no-branch' };
  return { url: alias, limit: 'branch-alias', deploymentId, team, project };
}

// One observation of the commit statuses. Absent and untrusted are not a site and do not wait.
// Pending is the only state that waits. Several successful projects are not guessed between.
export function planDiscovery({ statuses, branch }) {
  const found = latestAuthenticStatuses(statuses);
  if (!found.length) return { action: 'not-a-site' };
  const success = found.filter((s) => s.state === 'success');
  const pending = found.some((s) => s.state === 'pending');
  if (!success.length && pending) return { action: 'wait' };
  if (success.length > 1) return { action: 'no-preview', limit: 'several-projects' };
  if (success.length === 1) {
    const preview = previewFromStatus(success[0].target_url, branch);
    if (!preview.url) return { action: 'no-preview', limit: preview.limit };
    return { action: 'use', ...preview };
  }
  const state = found.find((s) => s.state && s.state !== 'success')?.state || 'missing';
  return { action: 'finished', state };
}

export async function resolveStatusPreview({ readStatuses, branch, sleep, now, deadline }) {
  for (;;) {
    const plan = planDiscovery({ statuses: await readStatuses(), branch });
    if (plan.action !== 'wait') return plan;
    if (now() >= deadline) return { action: 'finished', state: 'pending' };
    await sleep(20000);
  }
}

export function documentDeploymentId(body) {
  const tag = String(body || '').match(/<html\b[^>]*>/i);
  if (!tag) return '';
  const attr = tag[0].match(/\bdata-dpl-id\s*=\s*(["'])(dpl_[A-Za-z0-9]+)\1/i);
  return attr ? attr[2] : '';
}

export function responseProvesDeployment({ body, deploymentId } = {}) {
  const id = String(deploymentId || '');
  if (!/^[A-Za-z0-9]{8,}$/.test(id)) return false;
  return documentDeploymentId(body) === `dpl_${id}`;
}

export function protectionStatus(status, location) {
  if (status === 401 || status === 403) return true;
  if (status >= 300 && status < 400 && location) {
    try {
      const url = new URL(location);
      return url.hostname === 'vercel.com' && url.pathname.startsWith('/sso-api');
    } catch {
      return false;
    }
  }
  return false;
}
