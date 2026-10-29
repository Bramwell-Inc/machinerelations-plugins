// One source of truth for what a release is: the version, its notes and the
// skills it carries, read from the reviewed tree. No network.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const REPO = 'Bramwell-Inc/machinerelations-plugins';
export const PLUGIN_ROOT = 'plugins/machine-relations-index';
export const PACKAGE_FILE = 'machine-relations-index.zip';
export const LIBRARY_FILE = 'library.json';
export const SUMS_FILE = 'SHA256SUMS';
export const COMMIT_FILE = 'SOURCE_COMMIT';
export const LIBRARY_TITLE = 'Machine Relations Skills';
export const AUTHOR = Object.freeze({
  name: 'Jaxon Parrott',
  given: 'Jaxon',
  family: 'Parrott',
  url: 'https://jaxonparrott.com',
  id: 'https://jaxonparrott.com/#person',
  orcid: '0009-0004-0039-3913',
});
export const PUBLISHER = Object.freeze({
  name: 'Machine Relations Research',
  url: 'https://machinerelations.ai',
  '@id': 'https://machinerelations.ai/about#research',
  wikidata: 'https://www.wikidata.org/wiki/Q141909235',
});
/** The library's own Wikidata item and concept DOI (all versions); both are permanent. */
export const LIBRARY_WIKIDATA = 'https://www.wikidata.org/wiki/Q141909117';
export const CONCEPT_DOI = '10.5281/zenodo.23749768';
export const LICENSE_URL = 'https://spdx.org/licenses/MIT.html';
/** Each site keeps its own job: the author's library on JP, install and standard on MR. */
export const PAGES = Object.freeze({ author: 'https://jaxonparrott.com/skills', install: 'https://machinerelations.ai/skill' });
export const DESCRIPTOR = "The World's First Machine Relations Agency";

/** "1.2.3" -> [1, 2, 3]; anything else throws. */
export function parseVersion(text) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(text));
  if (!match) throw new Error(`Not a semver version: ${text}`);
  return match.slice(1).map(Number);
}

export function compareVersions(a, b) {
  const [x, y] = [parseVersion(a), parseVersion(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** Every `## [x.y.z] - YYYY-MM-DD` entry, newest first, with its prose. */
export function parseChangelog(text) {
  const entries = [];
  const heading = /^## \[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})\s*$/gm;
  const marks = [...text.matchAll(heading)];
  marks.forEach((mark, i) => {
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
    const notes = text.slice(mark.index + mark[0].length, end).trim().replace(/\s*\n\s*/g, ' ');
    entries.push({ version: mark[1], date: mark[2], notes });
  });
  return entries;
}

/** The few frontmatter fields a SKILL.md carries; quoted or bare scalars. */
export function skillFrontmatter(text) {
  const block = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!block) throw new Error('SKILL.md has no frontmatter');
  const scalar = (raw) => {
    const value = raw.trim();
    if (value.startsWith('"')) return JSON.parse(value);
    if (value.startsWith("'")) return value.slice(1, -1).replace(/''/g, "'");
    return value;
  };
  const top = (key) => {
    const line = new RegExp(`^${key}: (.+)$`, 'm').exec(block[1]);
    return line ? scalar(line[1]) : undefined;
  };
  const meta = (key) => {
    const line = new RegExp(`^metadata:\\n(?:[ ]{2}.*\\n)*?[ ]{2}${key}: (.+)$`, 'm').exec(`${block[1]}\n`);
    return line ? scalar(line[1]) : undefined;
  };
  // title and summary are the human name and one-sentence practitioner summary pages show;
  // description stays the host's trigger text.
  return { name: top('name'), description: top('description'), version: meta('version'), title: meta('title'), summary: meta('summary') };
}

export function readCitation(text) {
  const field = (key) => {
    const line = new RegExp(`^${key}: (.+)$`, 'm').exec(text);
    if (!line) return undefined;
    const value = line[1].trim();
    return value.startsWith('"') ? JSON.parse(value) : value;
  };
  const orcid = /^\s+orcid: "?(https:\/\/orcid\.org\/[0-9X-]+)"?\s*$/m.exec(text);
  return { version: field('version'), dateReleased: field('date-released'), title: field('title'), doi: field('doi'), orcid: orcid?.[1], wikidata: new RegExp(`^\\s+value: "${LIBRARY_WIKIDATA.replace(/[.\/]/g, '\\$&')}"\\s*$`, 'm').test(text) };
}

/** The release as the reviewed tree states it. */
export function readRelease(root = process.cwd()) {
  const at = (path) => resolve(root, path);
  const manifest = JSON.parse(readFileSync(at(`${PLUGIN_ROOT}/plugin.json`), 'utf8'));
  const changelog = parseChangelog(readFileSync(at('CHANGELOG.md'), 'utf8'));
  const skillsDir = at(`${PLUGIN_ROOT}/skills`);
  const skills = readdirSync(skillsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(resolve(skillsDir, entry.name, 'SKILL.md')))
    .map((entry) => {
      const path = `${PLUGIN_ROOT}/skills/${entry.name}/SKILL.md`;
      const meta = skillFrontmatter(readFileSync(at(path), 'utf8'));
      return { slug: entry.name, path, ...meta };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return { version: manifest.version, manifest, changelog, latest: changelog[0], skills };
}

export const skillArchive = (slug) => `skill-${slug}.tar.gz`;
export const releaseTag = (version) => `v${version}`;
export const assetUrl = (version, file) => `https://github.com/${REPO}/releases/download/${releaseTag(version)}/${file}`;
