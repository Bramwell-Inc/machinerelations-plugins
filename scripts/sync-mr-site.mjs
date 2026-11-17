import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { LIBRARY_FILE, REPO, readRelease, releaseTag } from './library.mjs';

const SITE = 'Bramwell-Inc/machinerelations.ai';
const MANIFEST = 'data/skill-library.json';
const BRANCH = 'sync-machine-relations-skill-library';

function versionOf(bytes) {
  const library = JSON.parse(bytes.toString());
  const { version } = library;
  if (library.schema !== 'machinerelations_skill_library_v1' ||
      typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version) ||
      library.source?.tag !== releaseTag(version)) {
    throw new Error('Invalid published Machine Relations skill library');
  }
  return version;
}

function compareVersions(left, right) {
  const current = left.split('.').map(Number);
  const target = right.split('.').map(Number);
  return current[0] - target[0] || current[1] - target[1] || current[2] - target[2];
}

export async function syncSite({ version, bytes, repository }) {
  if (versionOf(bytes) !== version) throw new Error('The release and library versions differ');

  function compareFile(file) {
    const current = Buffer.from(file.content, 'base64');
    const order = compareVersions(versionOf(current), version);
    if (order === 0 && !current.equals(bytes)) {
      throw new Error(`Published library ${version} differs from the bytes already in site Git`);
    }
    return order;
  }

  const main = await repository(`contents/${MANIFEST}?ref=main`);
  if (compareFile(main) >= 0) return 'The site already has this release or a newer one.';

  const [open] = await repository(`pulls?state=open&base=main&head=Bramwell-Inc:${BRANCH}`);
  let proposed = main;
  if (open) {
    proposed = await repository(`contents/${MANIFEST}?ref=${BRANCH}`);
  } else {
    const ref = await repository(`git/ref/heads/${BRANCH}`, { optional: true });
    const base = await repository('git/ref/heads/main');
    if (!ref) {
      await repository('git/refs', { method: 'POST', body: { ref: `refs/heads/${BRANCH}`, sha: base.object.sha } });
    } else if (ref.object.sha !== base.object.sha) {
      await repository(`git/refs/heads/${BRANCH}`, { method: 'PATCH', body: { sha: base.object.sha, force: true } });
    }
    proposed = await repository(`contents/${MANIFEST}?ref=${BRANCH}`);
  }
  const order = compareFile(proposed);
  if (order > 0) return 'A newer library update is already in progress.';
  if (order < 0) {
    await repository(`contents/${MANIFEST}`, {
      method: 'PUT',
      body: {
        message: `Publish Machine Relations Skills ${version}`,
        content: bytes.toString('base64'),
        branch: BRANCH,
        sha: proposed.sha,
      },
    });
  }

  return (open ?? await repository('pulls', {
    method: 'POST',
    body: {
      head: BRANCH,
      base: 'main',
      title: `Publish Machine Relations Skills ${version}`,
      body: `Use the exact published library artifact from https://github.com/${REPO}/releases/tag/${releaseTag(version)}.`,
    },
  })).html_url;
}

async function githubRepository(path, { method = 'GET', body, optional } = {}) {
  const response = await fetch(`https://api.github.com/repos/${SITE}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.MR_SITE_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: body && JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (optional && response.status === 404) return null;
  if (!response.ok) throw new Error(`GitHub ${method} ${path} failed (${response.status})`);
  return response.json();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.MR_SITE_TOKEN) throw new Error('MR_SITE_TOKEN is missing');
  const { version } = readRelease();
  const tag = releaseTag(version);
  const release = JSON.parse(execFileSync('gh', ['release', 'view', tag, '-R', REPO, '--json', 'isDraft,isPrerelease']));
  if (release.isDraft || release.isPrerelease) throw new Error(`The library release ${tag} is not public`);
  const bytes = execFileSync('gh', ['release', 'download', tag, '-R', REPO, '--pattern', LIBRARY_FILE, '--output', '-']);
  console.log(await syncSite({ version, bytes, repository: githubRepository }));
}
