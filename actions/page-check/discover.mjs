// How a commit's Vercel preview is found with only the GitHub token the Action already has.
// A GitHub deployment record is the pinned address. Some linked projects never write one and only
// post a Vercel commit status whose target is the inspector (vercel.com/team/project/id). The
// branch alias is then the preview. It follows the latest deployment of that branch, not the commit.
// No Vercel token is read or required.

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

export function previewFromStatus(targetUrl, branch) {
  let url;
  try {
    url = new URL(String(targetUrl || ''));
  } catch {
    return { url: '', limit: 'unrecognized' };
  }
  if (url.hostname.endsWith('.vercel.app')) return { url: url.origin, limit: 'status-host' };
  if (url.hostname !== 'vercel.com') return { url: '', limit: 'unrecognized' };
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts.length < 3) return { url: '', limit: 'unrecognized' };
  const alias = branchPreviewUrl(parts[0], parts[1], branch);
  if (!alias) return { url: '', limit: branch ? 'alias-too-long' : 'no-branch' };
  return { url: alias, limit: 'branch-alias' };
}

export function vercelStatus(statuses) {
  const list = Array.isArray(statuses) ? statuses : [];
  return list.find((s) => s?.context === 'Vercel') || list.find((s) => /^Vercel\b/.test(String(s?.context || ''))) || null;
}
