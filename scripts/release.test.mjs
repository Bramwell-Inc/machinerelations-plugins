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
  assert.deepEqual(skillFrontmatter('---\nname: a\ndescription: "x: y"\nmetadata:\n  version: "1.0.0"\n---\nbody'), { name: 'a', description: 'x: y', version: '1.0.0' });
  assert.equal(skillFrontmatter('---\nname: a\ndescription: b\n---\n').version, undefined);
});

test('citation fields', () => {
  const c = readCitation('version: "1.1.4"\ndate-released: "2026-10-28"\nauthors:\n  - family-names: P\n    orcid: "https://orcid.org/0009-0004-0039-3913"\n');
  assert.deepEqual(c, { version: '1.1.4', dateReleased: '2026-10-28', title: undefined, orcid: 'https://orcid.org/0009-0004-0039-3913' });
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
if (args[0] === 'release' && (args[1] === 'create' || args[1] === 'upload')) {
  const assets = args.filter((a) => a.startsWith('/')).map((a) => ({ name: path.basename(a) }));
  fs.writeFileSync(file, JSON.stringify({ assets, isDraft: false }));
  process.exit(0);
}
process.exit(2);
`;
  writeFileSync(join(dir, 'gh'), script);
  chmodSync(join(dir, 'gh'), 0o755);
  return { log, releases };
}

function hookServer() {
  const calls = [];
  const server = createServer((req, res) => { calls.push(req.url); res.writeHead(201, { 'Content-Type': 'application/json' }); res.end('{"job":{"id":"j1"}}'); });
  return { server, calls };
}

const listen = (server) => new Promise((ok) => server.listen(0, '127.0.0.1', ok));

test('publish deposits once, releases once and adopts on retry', async () => {
  const zen = fakeZenodo();
  const hooks = hookServer();
  await listen(zen.server);
  await listen(hooks.server);
  const dir = mkdtempSync(join(tmpdir(), 'mr-release-'));
  const gh = fakeGh(dir);
  const dist = join(dir, 'dist');
  const run = async (extraEnv = {}) => (await promisify(execFile)(process.execPath, [resolve('scripts/publish-release.mjs'), '--dist', dist], {
    encoding: 'utf8',
    env: {
      ...process.env,
      NODE_USE_ENV_PROXY: '', HTTP_PROXY: '', HTTPS_PROXY: '', http_proxy: '', https_proxy: '',
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
    execFileSync(process.execPath, [resolve('scripts/build-release.mjs'), '--dist', dist]);
  };
  try {
    pack();
    const first = await run();
    assert.match(first, /plan for .*: create/);
    assert.equal(zen.state.published.length, 1);
    const library = JSON.parse(readFileSync(join(dist, 'library.json'), 'utf8'));
    const id = zen.state.published[0];
    assert.equal(library.doi.version, `10.5281/zenodo.${id}`);
    assert.equal(library.doi.concept, `10.5281/zenodo.${id - 1}`);
    assert.match(library.citation, new RegExp(`https://doi.org/10.5281/zenodo.${id}$`));
    const stored = zen.state.files.get(id);
    assert.deepEqual([...stored.keys()].sort(), readdirSync(dist).sort(), 'Zenodo holds every release file');
    for (const name of stored.keys()) assert.ok(stored.get(name).equals(readFileSync(join(dist, name))), `${name} identical on Zenodo and GitHub`);
    const calls = readFileSync(gh.log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const create = calls.find((c) => c[1] === 'create');
    assert.ok(create.includes('--latest') && create.includes(library.source.commit));
    assert.deepEqual(hooks.calls, ['/hook-a', '/hook-b']);

    // Rerun after success: nothing deposited, nothing called.
    assert.match(await run(), /already released/);
    assert.equal(zen.state.published.length, 1);
    assert.equal(hooks.calls.length, 2);

    // GitHub release lost after Zenodo published: adopt Zenodo's exact bytes.
    rmSync(join(gh.releases, `${library.source.tag}.json`));
    pack();
    assert.match(await run(), /adopt/);
    assert.equal(zen.state.published.length, 1, 'never deposits a version twice');
    for (const name of stored.keys()) assert.ok(stored.get(name).equals(readFileSync(join(dist, name))));

    // Missing hooks fail loudly after the release exists.
    rmSync(join(gh.releases, `${library.source.tag}.json`));
    pack();
    await assert.rejects(run({ VERCEL_DEPLOY_HOOKS: '' }), /No deploy hooks/);
    assert.ok(existsSync(join(gh.releases, `${library.source.tag}.json`)));
  } finally {
    zen.server.close();
    hooks.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
