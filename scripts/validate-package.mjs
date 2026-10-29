// Cross-client invariants that a directory ZIP must satisfy. No network or deps.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { AUTHOR, CONCEPT_DOI, DESCRIPTOR, compareVersions, readCitation, readRelease } from './library.mjs';

const root = resolve('plugins/machine-relations-index');
const read = (name) => JSON.parse(readFileSync(resolve(root, name), 'utf8'));
const codex = read('plugin.json');
const claude = read('.claude-plugin/plugin.json');
assert.equal(codex.name, 'machine-relations-index');
assert.equal(claude.name, codex.name);
assert.equal(claude.version, codex.version, 'Both clients must ship the same package version');
assert.match(codex.version, /^\d+\.\d+\.\d+$/);
assert.ok(codex.extensions['com.openai'].interface.shortDescription.length <= 30, 'Directory subtitle must fit its 30-character limit');
assert.equal(readFileSync(resolve(root, 'LICENSE'), 'utf8'), readFileSync('LICENSE', 'utf8'), 'The standalone package must carry its declared license');

// Git-backed clients cache versions: changing packaged files without a bump
// must fail at the PR/push seam, not become a release-owner memory task.
const base = process.env.PACKAGE_BASE_SHA;
if (base && !/^0+$/.test(base)) {
  assert.match(base, /^[a-f0-9]{40}$/);
  const changed = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--', 'plugins/machine-relations-index'], { encoding: 'utf8' }).trim();
  if (changed) {
    const previous = JSON.parse(execFileSync('git', ['show', `${base}:plugins/machine-relations-index/plugin.json`], { encoding: 'utf8' }));
    const before = previous.version.split('.').map(Number);
    const after = codex.version.split('.').map(Number);
    assert.ok(after.some((part, i) => part > before[i] && after.slice(0, i).every((n, j) => n === before[j])), 'Packaged files changed: increase both manifest versions before shipping');
  }
}

const endpoint = 'https://machinerelations.ai/mcp';
for (const [file, transport] of [['mcp.json', 'streamable-http'], ['.mcp.json', 'http']]) {
  const servers = read(file).mcpServers;
  assert.deepEqual(Object.keys(servers), ['machine-relations-index']);
  assert.equal(servers[codex.name].url, endpoint);
  assert.equal(servers[codex.name].type, transport);
}
for (const file of [claude.icon, codex.extensions['com.openai'].interface.logo, codex.extensions['com.openai'].interface.composerIcon]) {
  assert.equal(typeof file, 'string');
  const path = resolve(root, file);
  assert.ok(!relative(root, path).startsWith('..'), 'Assets must be in the uploaded package');
  assert.ok(existsSync(path), `Missing package asset: ${file}`);
}
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
assert.ok(readme.replace(/```[\s\S]*?```/g, '').trim().split(/\s+/).length >= 40, 'The installed package needs its own substantive README');
for (const path of ['/developers', '/contact', '/privacy', '/terms']) {
  assert.ok(readme.includes(`https://machinerelations.ai${path}`), `Packaged README must link to ${path}`);
}
const skill = readFileSync(resolve(root, 'skills/machine-relations-index/SKILL.md'), 'utf8');
assert.ok(skill.includes('source.guidance'), 'The installed skill must read the live interpretation owner');
for (const name of ['machine-relations', 'machine-relations-index']) {
  const content = readFileSync(resolve(root, `skills/${name}/SKILL.md`), 'utf8');
  assert.ok(content.startsWith(`---\nname: ${name}\n`), `Discoverable skill identity: ${name}`);
  assert.match(content, /\ndescription: .+/);
  for (const match of content.matchAll(/\]\((references\/[^)]+)\)/g)) {
    const target = resolve(root, `skills/${name}`, match[1]);
    assert.ok(!relative(root, target).startsWith('..'));
    assert.ok(existsSync(target), `Missing packaged skill reference: ${match[1]}`);
  }
}
// One version everywhere a reader or citation can see it.
const release = readRelease();
const [latest, previous] = release.changelog;
assert.ok(latest, 'CHANGELOG.md needs a `## [x.y.z] - YYYY-MM-DD` entry');
assert.equal(latest.version, codex.version, 'The newest CHANGELOG entry must be the package version');
assert.ok(latest.notes.length >= 40, 'The newest CHANGELOG entry needs a practitioner-facing note');
if (previous) assert.ok(compareVersions(latest.version, previous.version) > 0, 'CHANGELOG versions must increase');
assert.equal(codex.extensions['com.openai'].publication.release_notes, latest.notes, 'Directory release notes are the newest CHANGELOG entry, verbatim');
for (const skill of release.skills) {
  assert.equal(skill.name, skill.slug, `${skill.path}: name must match its folder`);
  assert.equal(skill.version, codex.version, `${skill.path}: metadata.version must be the package version`);
  assert.equal(skill.title === undefined, skill.summary === undefined, `${skill.path}: metadata.title and metadata.summary go together`);
  if (skill.summary !== undefined) {
    assert.ok(skill.title.length >= 3 && skill.summary.length >= 20, `${skill.path}: a human title and a one-sentence summary`);
    assert.doesNotMatch(skill.summary, /^use when/i, `${skill.path}: metadata.summary is for practitioners, not host trigger text`);
  }
}
const citation = readCitation(readFileSync('CITATION.cff', 'utf8'));
assert.equal(citation.version, codex.version, 'CITATION.cff version must be the package version');
assert.equal(citation.dateReleased, latest.date, 'CITATION.cff date-released must be the newest CHANGELOG date');
assert.equal(citation.orcid, `https://orcid.org/${AUTHOR.orcid}`, 'CITATION.cff must carry the author ORCID');
assert.equal(citation.doi, CONCEPT_DOI, 'CITATION.cff doi is the concept DOI (all versions)');
assert.ok(citation.wikidata, 'CITATION.cff lists the library Wikidata item');
for (const manifest of [codex, claude]) {
  assert.deepEqual(manifest.author, { name: AUTHOR.name, url: AUTHOR.url }, 'The skills are authored by Jaxon Parrott');
}

// Public text: exact agency descriptor, no internal ids, paths or secrets.
const publicFiles = [
  'README.md', 'CHANGELOG.md', 'CITATION.cff',
  ...execFileSync('git', ['ls-files', 'plugins'], { encoding: 'utf8' }).split('\n').filter((f) => /\.(md|json|ya?ml|txt)$/.test(f)),
];
for (const file of publicFiles) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/first machine relations agency/gi)) {
    const start = match.index - 'The World\'s '.length;
    assert.equal(text.slice(start, match.index + match[0].length), DESCRIPTOR, `${file}: AuthorityTech is exactly "${DESCRIPTOR}"`);
  }
  assert.doesNotMatch(text, /\bBrain\s+(?:seq\s*)?#?\d{3,6}\b|\bseq\s?\d{4,6}\b/i, `${file}: no internal Brain ids in public files`);
  assert.doesNotMatch(text, /\/home\/jarvis|\.openclaw\/|jarvis-runtime\/|workspace-[a-z]+\//, `${file}: no internal paths in public files`);
  assert.doesNotMatch(text, /\b(?:ghp_|gho_|github_pat_|xox[abp]-|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{20,})/, `${file}: no secrets in public files`);
}

for (const client of ['.agents/plugins', '.claude-plugin']) {
  const marketplace = JSON.parse(readFileSync(`${client}/marketplace.json`, 'utf8'));
  const plugin = marketplace.plugins.find((p) => p.name === codex.name);
  assert.ok(plugin, `${client} must expose the package`);
  assert.equal(typeof plugin.source === 'string' ? plugin.source : plugin.source.path, './plugins/machine-relations-index');
}
console.log(`Validated ${codex.name} ${codex.version}`);
