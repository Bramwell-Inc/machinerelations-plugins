// node --test scripts/release.test.mjs
// Runs the real publish path against a fake Zenodo, a fake `gh` and a fake
// deploy hook, because a published Zenodo version can never be deleted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseChangelog, skillFrontmatter, readCitation } from './library.mjs';
import { planZenodo, CONCEPT_MARKER } from './publish-release.mjs';

test('changelog entries parse newest first with flattened notes', () => {
  const entries = parseChangelog('# C\n\n## [1.2.0] - 2026-11-01\n\nLine one\nline two.\n\n## [1.1.0] - 2026-10-01\n\nOld.\n');
  assert.deepEqual(entries, [
    { version: '1.2.0', date: '2026-11-01', notes: 'Line one line two.' },
    { version: '1.1.0', date: '2026-10-01', notes: 'Old.' },
  ]);
});

test('skill frontmatter reads quoted, bare and nested version', () => {
  assert.deepEqual(skillFrontmatter('---\nname: a\ndescription: "x: y"\nmetadata:\n  version: "1.0.0"\n---\nbody'), { name: 'a', description: 'x: y', version: '1.0.0', title: undefined, summary: undefined });
  assert.equal(skillFrontmatter('---\nname: a\ndescription: b\n---\n').version, undefined);
  const titled = skillFrontmatter('---\nname: a\ndescription: b\nmetadata:\n  version: "1.0.0"\n  title: "Query-set-first consolidation"\n  summary: "Merge pages only when their real query sets match."\n---\n');
  assert.deepEqual([titled.version, titled.title, titled.summary], ['1.0.0', 'Query-set-first consolidation', 'Merge pages only when their real query sets match.']);
});

test('citation names the library Wikidata item only on an exact value line', () => {
  const at = (body) => readCitation(body).wikidata;
  assert.equal(at('identifiers:\n  - type: url\n    value: "https://www.wikidata.org/wiki/Q141909117"\n'), true);
  assert.equal(at('identifiers:\n  - type: url\n    value: "https://www.wikidata.org/wiki/Q1419091170"\n'), false);
  assert.equal(at('abstract: "see https://www.wikidata.org/wiki/Q141909117"\n'), false);
});

test('citation fields', () => {
  const c = readCitation('version: "1.1.4"\ndate-released: "2026-10-28"\ndoi: "10.5281/zenodo.1"\nauthors:\n  - family-names: P\n    orcid: "https://orcid.org/0009-0004-0039-3913"\n');
  assert.deepEqual(c, { version: '1.1.4', dateReleased: '2026-10-28', title: undefined, doi: '10.5281/zenodo.1', orcid: 'https://orcid.org/0009-0004-0039-3913', wikidata: false });
});

const ours = (extra) => ({ conceptrecid: 7, metadata: { keywords: [CONCEPT_MARKER], version: '1.0.0' }, listStatus: 'published', id: 8, ...extra });

test('Zenodo plan: create, new version, reuse draft, adopt, refuse ambiguity', () => {
  assert.equal(planZenodo([{ id: 1, conceptrecid: 2, metadata: { keywords: ['other'] }, listStatus: 'published' }], '1.0.0').action, 'create');
  assert.equal(planZenodo([ours()], '1.0.0').action, 'adopt');
  const next = planZenodo([ours(), ours({ id: 12, metadata: { keywords: [CONCEPT_MARKER], version: '1.0.1' } })], '1.0.2');
  assert.deepEqual([next.action, next.deposit.id], ['new-version', 12]);
  assert.equal(planZenodo([ours(), ours({ id: 13, listStatus: 'draft', metadata: { keywords: [CONCEPT_MARKER] } })], '1.0.1').action, 'reuse-draft');
  assert.throws(() => planZenodo([ours(), ours({ id: 9, conceptrecid: 99 })], '1.0.1'), /More than one Zenodo concept/);
  assert.throws(() => planZenodo([ours(), ours({ id: 9 })], '1.0.0'), /more than once/);
});

/** Minimal in-memory Zenodo deposit API. */
function fakeZenodo() {
  const state = { deposits: new Map(), files: new Map(), nextId: 100, published: [] };
  const md5 = (b) => createHash('md5').update(b).digest('hex');
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const url = new URL(req.url, base);
      const body = Buffer.concat(chunks);
      const send = (code, json) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(json)); };
      const view = (d) => ({ ...d, files: [...(state.files.get(d.id) ?? new Map()).entries()].map(([name, b]) => ({ filename: name, checksum: md5(b), links: { self: `${base}/api/files/${d.id}/${name}`, download: `${base}/api/files/${d.id}/${name}` } })), links: { bucket: `${base}/api/bucket/${d.id}`, latest_draft: `${base}/api/deposit/depositions/${d.latestDraft}` } });
      const parts = url.pathname.split('/').filter(Boolean);
      if (req.headers.authorization !== 'Bearer test-zenodo-token') return send(401, {});
      if (url.pathname === '/api/deposit/depositions' && req.method === 'GET') {
        const status = url.searchParams.get('status');
        return send(200, [...state.deposits.values()].filter((d) => (status === 'published') === d.submitted).map(view));
      }
      if (url.pathname === '/api/deposit/depositions' && req.method === 'POST') {
        const id = state.nextId++;
        const d = { id, conceptrecid: id - 1, submitted: false, metadata: JSON.parse(body).metadata };
        state.deposits.set(id, d);
        return send(201, view(d));
      }
      if (parts[1] === 'deposit' && parts.length === 4) {
        const d = state.deposits.get(Number(parts[3]));
        if (req.method === 'PUT') {
          const metadata = JSON.parse(body).metadata;
          if (metadata.prereserve_doi) metadata.prereserve_doi = { doi: `10.5281/zenodo.${d.id}`, recid: d.id };
          d.metadata = metadata;
        }
        return send(200, view(d));
      }
      if (parts[4] === 'actions' && parts[5] === 'newversion') {
        const prev = state.deposits.get(Number(parts[3]));
        const id = state.nextId++;
        state.deposits.set(id, { id, conceptrecid: prev.conceptrecid, submitted: false, metadata: { ...prev.metadata } });
        state.files.set(id, new Map(state.files.get(prev.id)));
        prev.latestDraft = id;
        return send(201, view(prev));
      }
      if (parts[4] === 'actions' && parts[5] === 'publish') {
        const d = state.deposits.get(Number(parts[3]));
        d.submitted = true;
        d.doi = d.metadata.prereserve_doi.doi;
        state.published.push(d.id);
        return send(202, view(d));
      }
      if (parts[1] === 'bucket' && req.method === 'PUT') {
        const id = Number(parts[2]);
        if (!state.files.has(id)) state.files.set(id, new Map());
        state.files.get(id).set(decodeURIComponent(parts[3]), body);
        return send(201, { checksum: `md5:${md5(body)}` });
      }
      if (parts[1] === 'files') {
        const files = state.files.get(Number(parts[2]));
        if (req.method === 'DELETE') { files.delete(parts[3]); res.writeHead(204); return res.end(); }
        res.writeHead(200); return res.end(files.get(parts[3]));
      }
      send(404, { path: url.pathname });
    });
  });
  return { server, state };
}

function fakeGh(dir) {
  const log = join(dir, 'gh.log');
  const releases = join(dir, 'releases');
  mkdirSync(releases);
  const script = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const tag = args[2]; const file = path.join(${JSON.stringify(releases)}, tag + '.json');
if (args[0] === 'release' && args[1] === 'view') {
  if (!fs.existsSync(file)) { process.stderr.write('release not found'); process.exit(1); }
  process.stdout.write(fs.readFileSync(file)); process.exit(0);
}
if (args[0] === 'release' && args[1] === 'delete') { fs.rmSync(file); process.exit(0); }
if (args[0] === 'release' && args[1] === 'create') {
  if (fs.existsSync(file)) { process.stderr.write('a release with the same tag name already exists'); process.exit(1); }
  const assets = args.filter((a) => a.startsWith('/')).map((a) => ({ name: path.basename(a) }));
  if (process.env.FAKE_GH_FAIL_UPLOAD) { fs.writeFileSync(file, JSON.stringify({ assets: assets.slice(0, 1), isDraft: true })); process.exit(1); }
  fs.writeFileSync(file, JSON.stringify({ assets, isDraft: false }));
  process.exit(0);
}
process.exit(2);
`;
  writeFileSync(join(dir, 'gh'), script);
  chmodSync(join(dir, 'gh'), 0o755);
  return { log, releases };
}

/** Deploy hooks plus GitHub's releases/latest library.json, which can lag a fresh release. */
function hookServer() {
  const calls = [];
  const state = { latest: null, staleReads: 0, reads: 0 };
  const server = createServer((req, res) => {
    if (req.url.startsWith('/latest')) {
      state.reads++;
      const stale = state.staleReads > 0 && state.staleReads--;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ version: stale ? '0.0.0' : state.latest?.() }));
    }
    calls.push(req.url);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end('{"job":{"id":"j1"}}');
  });
  return { server, calls, state };
}

const listen = (server) => new Promise((ok) => server.listen(0, '127.0.0.1', ok));

/** A throwaway git copy of the tracked tree, so a test can bump the version. */
function treeCopy(dir) {
  const tree = join(dir, 'tree');
  mkdirSync(tree);
  for (const file of execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n')) {
    if (file.startsWith('review/')) continue;
    mkdirSync(join(tree, file, '..'), { recursive: true });
    writeFileSync(join(tree, file), readFileSync(file));
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: tree });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const bump = (from, to) => {
    for (const file of ['plugins/machine-relations-index/plugin.json', 'plugins/machine-relations-index/.claude-plugin/plugin.json', 'CITATION.cff',
      ...readdirSync(join(tree, 'plugins/machine-relations-index/skills')).map((s) => `plugins/machine-relations-index/skills/${s}/SKILL.md`)]) {
      const path = join(tree, file);
      writeFileSync(path, readFileSync(path, 'utf8').replaceAll(`"${from}"`, `"${to}"`).replace('date-released: "2026-10-29"', 'date-released: "2026-11-02"'));
    }
    const changelog = join(tree, 'CHANGELOG.md');
    const text = readFileSync(changelog, 'utf8');
    const at = text.indexOf('## [');
    writeFileSync(changelog, `${text.slice(0, at)}## [${to}] - 2026-11-02\n\nA test patch release that changes nothing a practitioner would notice at all.\n\n${text.slice(at)}`);
    const manifest = join(tree, 'plugins/machine-relations-index/plugin.json');
    const json = JSON.parse(readFileSync(manifest, 'utf8'));
    json.extensions['com.openai'].publication.release_notes = 'A test patch release that changes nothing a practitioner would notice at all.';
    writeFileSync(manifest, `${JSON.stringify(json, null, 2)}\n`);
    git('commit', '-qam', `bump ${to}`);
  };
  return { tree, bump };
}

test('publish: create, rerun, adopt, draft recovery, hook retry, tamper refusal, next version', async () => {
  const zen = fakeZenodo();
  const hooks = hookServer();
  await listen(zen.server);
  await listen(hooks.server);
  const dir = mkdtempSync(join(tmpdir(), 'mr-release-'));
  const gh = fakeGh(dir);
  const { tree, bump } = treeCopy(dir);
  const dist = join(dir, 'dist');
  const run = async (extraEnv = {}) => (await promisify(execFile)(process.execPath, [join(tree, 'scripts/publish-release.mjs'), '--dist', dist], {
    cwd: tree,
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: '', HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '',
      GITHUB_RUN_ATTEMPT: '1',
      LATEST_LIBRARY_URL: `http://127.0.0.1:${hooks.server.address().port}/latest`,
      LATEST_WAIT_MS: '10',
      PATH: `${dir}:${process.env.PATH}`,
      ZENODO_API: `http://127.0.0.1:${zen.server.address().port}/api`,
      ZENODO_TOKEN: 'test-zenodo-token',
      GH_TOKEN: 'test-gh-token',
      VERCEL_DEPLOY_HOOKS: `http://127.0.0.1:${hooks.server.address().port}/hook-a\nhttp://127.0.0.1:${hooks.server.address().port}/hook-b\n`,
      ...extraEnv,
    },
  })).stdout;
  const pack = () => {
    rmSync(dist, { recursive: true, force: true });
    mkdirSync(dist);
    writeFileSync(join(dist, 'machine-relations-index.zip'), 'zip-bytes');
    execFileSync(process.execPath, [join(tree, 'scripts/build-release.mjs'), '--dist', dist], { cwd: tree });
  };
  const releaseFile = (tag) => join(gh.releases, `${tag}.json`);
  hooks.state.latest = () => JSON.parse(readFileSync(join(dist, 'library.json'), 'utf8')).version;
  try {
    execFileSync(process.execPath, ['scripts/validate-package.mjs'], { cwd: tree });
    pack();
    assert.match(await run(), /plan for .*: create/);
    assert.equal(zen.state.published.length, 1);
    const library = JSON.parse(readFileSync(join(dist, 'library.json'), 'utf8'));
    const id = zen.state.published[0];
    assert.equal(library.doi.version, `10.5281/zenodo.${id}`);
    assert.equal(library.doi.concept, `10.5281/zenodo.${id - 1}`);
    assert.match(library.citation, new RegExp(`https://doi.org/10.5281/zenodo.${id}$`));
    assert.match(library.citation_concept, new RegExp(`Machine Relations Skills \\[Computer software\\]\\. Machine Relations Research\\. https://doi.org/10.5281/zenodo.${id - 1}$`));
    assert.equal(library.publisher['@id'], 'https://machinerelations.ai/about#research');
    assert.equal(library.wikidata, 'https://www.wikidata.org/wiki/Q141909117');
    assert.equal(library.publisher.wikidata, 'https://www.wikidata.org/wiki/Q141909235');
    assert.equal(library.license_url, 'https://spdx.org/licenses/MIT.html');
    assert.deepEqual(library.pages, { author: 'https://jaxonparrott.com/skills', install: 'https://machinerelations.ai/skill' });
    const deposited = [...zen.state.deposits.values()].find((d) => d.id === id).metadata;
    for (const target of ['https://jaxonparrott.com/skills', 'https://machinerelations.ai/skill', 'https://www.wikidata.org/wiki/Q141909117']) {
      assert.ok(deposited.related_identifiers.some((r) => r.identifier === target), `Zenodo relates ${target}`);
    }
    const stored = zen.state.files.get(id);
    assert.deepEqual([...stored.keys()].sort(), readdirSync(dist).sort(), 'Zenodo holds every release file');
    for (const name of stored.keys()) assert.ok(stored.get(name).equals(readFileSync(join(dist, name))), `${name} identical on Zenodo and GitHub`);
    const create = readFileSync(gh.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).find((c) => c[1] === 'create');
    assert.ok(create.includes('--latest') && create.includes(library.source.commit));
    assert.deepEqual(hooks.calls, ['/hook-a', '/hook-b']);
    const firstReads = hooks.state.reads;
    assert.ok(firstReads >= 1, 'checked releases/latest before rebuilding the sites');

    // Rerun after success: nothing deposited, no hooks on a first attempt...
    assert.match(await run(), /already released/);
    assert.equal(zen.state.published.length, 1);
    assert.equal(hooks.calls.length, 2);
    // ...but a retried run rebuilds the sites, after releases/latest serves this version.
    hooks.state.staleReads = 2;
    const retried = await run({ GITHUB_RUN_ATTEMPT: '2' });
    assert.equal(hooks.calls.length, 4);
    assert.equal(hooks.state.staleReads, 0, 'waited through the stale reads');
    assert.match(retried, /latest library.json serves/);

    // A latest that never catches up fails the run instead of rebuilding the sites with the old release.
    hooks.state.staleReads = 1000;
    await assert.rejects(run({ GITHUB_RUN_ATTEMPT: '2' }), /still does not serve/);
    assert.equal(hooks.calls.length, 4);
    hooks.state.staleReads = 0;

    // GitHub release lost after Zenodo published: adopt Zenodo's exact bytes.
    rmSync(releaseFile(library.source.tag));
    pack();
    assert.match(await run(), /adopt/);
    assert.equal(zen.state.published.length, 1, 'never deposits a version twice');
    for (const name of stored.keys()) assert.ok(stored.get(name).equals(readFileSync(join(dist, name))));

    // A failed upload leaves a draft; the rerun replaces it with one complete release.
    rmSync(releaseFile(library.source.tag));
    pack();
    await assert.rejects(run({ FAKE_GH_FAIL_UPLOAD: '1' }));
    assert.equal(JSON.parse(readFileSync(releaseFile(library.source.tag), 'utf8')).isDraft, true);
    await run();
    const recovered = JSON.parse(readFileSync(releaseFile(library.source.tag), 'utf8'));
    assert.equal(recovered.isDraft, false);
    assert.ok(recovered.assets.some((a) => a.name === 'library.json'));

    // Missing hooks fail loudly.
    rmSync(releaseFile(library.source.tag));
    pack();
    await assert.rejects(run({ VERCEL_DEPLOY_HOOKS: '' }), /No deploy hooks/);

    // Next version: a tampered artifact is refused before Zenodo publishes anything.
    bump('1.1.5', '1.1.6');
    execFileSync(process.execPath, ['scripts/validate-package.mjs'], { cwd: tree });
    pack();
    writeFileSync(join(dist, 'skill-machine-relations.tar.gz'), 'tampered');
    execFileSync(process.execPath, ['-e', `import('${join(tree, 'scripts/build-release.mjs')}').then((m) => m.writeSums(${JSON.stringify(dist)}))`], { cwd: tree });
    await assert.rejects(run(), /rebuilt as/);
    assert.equal(zen.state.published.length, 1);

    // The honest artifact then releases as a new version of the same concept, reusing the open draft.
    pack();
    const out = await run();
    assert.match(out, /plan for 1\.1\.6: reuse-draft/);
    assert.equal(zen.state.published.length, 2);
    const next = JSON.parse(readFileSync(join(dist, 'library.json'), 'utf8'));
    assert.equal(next.doi.concept, library.doi.concept, 'one concept DOI for every version');
    assert.notEqual(next.doi.version, library.doi.version);
    const nextFiles = zen.state.files.get(zen.state.published[1]);
    assert.deepEqual([...nextFiles.keys()].sort(), readdirSync(dist).sort());
    assert.ok(nextFiles.get('library.json').equals(readFileSync(join(dist, 'library.json'))), 'no 1.1.5 file survives in 1.1.6');

    // And 1.1.7 branches from the newest published version.
    bump('1.1.6', '1.1.7');
    pack();
    assert.match(await run(), /plan for 1\.1\.7: new-version/);
    assert.equal(zen.state.published.length, 3);
    assert.equal(JSON.parse(readFileSync(join(dist, 'library.json'), 'utf8')).doi.concept, library.doi.concept);
  } finally {
    zen.server.close();
    hooks.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validator: title and summary go together and the summary is not trigger text', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mr-validate-'));
  try {
    for (const file of execFileSync('git', ['ls-files'], { encoding: 'utf8' }).trim().split('\n')) {
      if (file.startsWith('review/')) continue;
      mkdirSync(join(dir, file, '..'), { recursive: true });
      writeFileSync(join(dir, file), readFileSync(file));
    }
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['add', '-A'], { cwd: dir });
    const skill = join(dir, 'plugins/machine-relations-index/skills/machine-relations/SKILL.md');
    const base = readFileSync(skill, 'utf8');
    const withMeta = (lines) => base.replace(/(\n {2}version: "[^"]+")/, `$1${lines}`);
    const validate = () => execFileSync(process.execPath, ['scripts/validate-package.mjs'], { cwd: dir, stdio: 'pipe' });
    validate();
    writeFileSync(skill, withMeta('\n  title: "Machine Relations"'));
    assert.throws(validate, /go together/);
    writeFileSync(skill, withMeta('\n  title: "Machine Relations"\n  summary: "Use when you need an authority brief for a brand."'));
    assert.throws(validate, /not host trigger text/);
    writeFileSync(skill, withMeta('\n  title: "Machine Relations"\n  summary: "Choose, draft and verify the next authority move for a brand."'));
    validate();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
