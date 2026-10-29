// Builds the release files from the reviewed tree into dist/, beside the
// plugin ZIP the workflow already made: one archive per skill, the source
// receipt, library.json and SHA256SUMS. No network. `--doi-concept` and
// `--doi-version` are set only by publish-release.mjs once Zenodo has
// reserved the DOIs; without them the library is a preview with null DOIs.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  AUTHOR, COMMIT_FILE, LIBRARY_FILE, LIBRARY_TITLE, PACKAGE_FILE, PLUGIN_ROOT, PUBLISHER, REPO, SUMS_FILE,
  assetUrl, readRelease, releaseTag, skillArchive,
} from './library.mjs';

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const doiUrl = (doi) => (doi ? `https://doi.org/${doi}` : null);

/** Deterministic per-skill archive: same tree and commit, same bytes. */
function archiveSkill(dist, slug, mtime) {
  const out = resolve(dist, skillArchive(slug));
  execFileSync('bash', ['-c',
    'set -o pipefail; tar --sort=name --mtime="@$1" --owner=0 --group=0 --numeric-owner --format=gnu -C "$2" -cf - "$3" | gzip -n -9 > "$4"',
    '_', String(mtime), resolve(PLUGIN_ROOT, 'skills'), slug, out]);
  return out;
}

export function buildLibrary({ release, commit, files, doi }) {
  const { version, latest, changelog, skills } = release;
  const file = (name) => ({ file: name, url: assetUrl(version, name), sha256: files[name].sha256, bytes: files[name].bytes });
  const citation = `${AUTHOR.family}, ${AUTHOR.given}. (${latest.date.slice(0, 4)}). ${LIBRARY_TITLE} (Version ${version}) [Computer software]. ${PUBLISHER.name}.${doi.version ? ` https://doi.org/${doi.version}` : ''}`;
  return {
    schema: 'machinerelations_skill_library_v1',
    name: LIBRARY_TITLE,
    version,
    released: latest.date,
    notes: latest.notes,
    author: { name: AUTHOR.name, url: AUTHOR.url, '@id': AUTHOR.id, orcid: `https://orcid.org/${AUTHOR.orcid}` },
    publisher: PUBLISHER,
    license: 'MIT',
    doi: {
      concept: doi.concept ?? null,
      concept_url: doiUrl(doi.concept),
      version: doi.version ?? null,
      version_url: doiUrl(doi.version),
    },
    citation,
    source: {
      repository: `https://github.com/${REPO}`,
      tag: releaseTag(version),
      commit,
      release_url: `https://github.com/${REPO}/releases/tag/${releaseTag(version)}`,
    },
    install: {
      claude_code: ['/plugin marketplace add Bramwell-Inc/machinerelations-plugins', '/plugin install machine-relations-index@machinerelations'],
      codex: ['codex plugin marketplace add Bramwell-Inc/machinerelations-plugins'],
      mcp: 'https://machinerelations.ai/mcp',
    },
    package: file(PACKAGE_FILE),
    skills: skills.map((skill) => ({
      name: skill.name,
      slug: skill.slug,
      description: skill.description,
      version: skill.version,
      source_url: `https://github.com/${REPO}/blob/${releaseTag(version)}/${skill.path}`,
      skill_md_sha256: sha256(readFileSync(skill.path)),
      archive: file(skillArchive(skill.slug)),
    })),
    changelog,
  };
}

export function writeSums(dist) {
  const names = readdirSync(dist).filter((name) => name !== SUMS_FILE).sort();
  const text = names.map((name) => `${sha256(readFileSync(resolve(dist, name)))}  ${name}\n`).join('');
  writeFileSync(resolve(dist, SUMS_FILE), text);
  return text;
}

export function build({ dist, doi = {} }) {
  const release = readRelease();
  if (!release.latest || release.latest.version !== release.version) throw new Error('CHANGELOG must lead with the package version');
  if (!existsSync(resolve(dist, PACKAGE_FILE))) throw new Error(`${PACKAGE_FILE} must be built before the library`);
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const mtime = Number(execFileSync('git', ['log', '-1', '--format=%ct', 'HEAD'], { encoding: 'utf8' }).trim());
  writeFileSync(resolve(dist, COMMIT_FILE), `${commit}\n`);
  for (const skill of release.skills) archiveSkill(dist, skill.slug, mtime);
  const files = {};
  for (const name of [PACKAGE_FILE, ...release.skills.map((s) => skillArchive(s.slug))]) {
    const bytes = readFileSync(resolve(dist, name));
    files[name] = { sha256: sha256(bytes), bytes: bytes.length };
  }
  const library = buildLibrary({ release, commit, files, doi });
  writeFileSync(resolve(dist, LIBRARY_FILE), `${JSON.stringify(library, null, 2)}\n`);
  writeSums(dist);
  return library;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values } = parseArgs({ options: { dist: { type: 'string', default: 'dist' }, 'doi-concept': { type: 'string' }, 'doi-version': { type: 'string' } } });
  const library = build({ dist: values.dist, doi: { concept: values['doi-concept'], version: values['doi-version'] } });
  console.log(`Built ${LIBRARY_FILE} ${library.version}: ${library.skills.map((s) => `${s.slug} ${s.archive.sha256.slice(0, 12)}`).join(', ')}`);
}
