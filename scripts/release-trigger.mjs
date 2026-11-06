// A push to main publishes only when the package version changed.
// A recovery commit that leaves the version alone must not run the publisher.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const VERSION = /^\d+\.\d+\.\d+$/;
const MANIFEST = 'plugins/machine-relations-index/plugin.json';

export function shouldPublish({ event, ref, previousVersion, currentVersion }) {
  if (event !== 'push' || ref !== 'refs/heads/main') return false;
  if (!VERSION.test(String(previousVersion ?? '')) || !VERSION.test(String(currentVersion ?? ''))) return false;
  return previousVersion !== currentVersion;
}

export function versionsFromGit(cwd = process.cwd()) {
  const current = JSON.parse(readFileSync(resolve(cwd, MANIFEST), 'utf8')).version ?? null;
  try {
    const previous = JSON.parse(execFileSync('git', ['show', `HEAD^:${MANIFEST}`], { cwd, encoding: 'utf8' })).version ?? null;
    return { previousVersion: previous, currentVersion: current };
  } catch {
    return { previousVersion: null, currentVersion: current };
  }
}

function report(publish, detail) {
  const line = `publish=${publish}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, line);
  console.log(JSON.stringify({ publish, ...detail }));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const versions = versionsFromGit();
  const event = process.env.RELEASE_EVENT ?? '';
  const ref = process.env.RELEASE_REF ?? '';
  report(shouldPublish({ event, ref, ...versions }), { event, ref, ...versions });
}
