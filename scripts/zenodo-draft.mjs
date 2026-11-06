// Read one existing Zenodo draft, or delete exactly one file on it.
// Inspect is the only default. A 500 stops the run. This never deletes the
// deposition, never calls newversion or publish, and never follows a file
// link that is not the documented draft-file URL.
import { CONCEPT_DOI, readRelease } from './library.mjs';
import { CONCEPT_MARKER } from './publish-release.mjs';

const FILE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function fileDeletePath(draftId, fileId) {
  if (!/^\d+$/.test(String(draftId))) throw new Error('draft id must be digits');
  if (!FILE_ID.test(String(fileId))) throw new Error('file id must be the draft file id');
  return `/deposit/depositions/${draftId}/files/${fileId}`;
}

export function publicView(draft) {
  return {
    id: draft.id ?? null,
    state: draft.state ?? null,
    submitted: draft.submitted ?? null,
    version: draft.metadata?.version ?? null,
    conceptrecid: draft.conceptrecid ?? null,
    doi: draft.metadata?.prereserve_doi?.doi ?? null,
    recid: draft.metadata?.prereserve_doi?.recid ?? null,
    marker: Array.isArray(draft.metadata?.keywords) && draft.metadata.keywords.includes(CONCEPT_MARKER),
    files: (draft.files ?? []).map((file) => ({
      id: file.id ?? null,
      filename: file.filename ?? null,
      checksum: file.checksum ?? null,
    })),
  };
}

export function assessDraft(draft, expect) {
  const problems = [];
  if (String(draft.id) !== String(expect.draftId)) problems.push('id');
  if (draft.state !== 'unsubmitted' || draft.submitted !== false) problems.push('not an unsubmitted draft');
  if (draft.metadata?.version !== expect.version) problems.push('version');
  if (String(draft.conceptrecid ?? '') !== String(expect.concept)) problems.push('concept');
  if (draft.metadata?.prereserve_doi?.doi !== expect.doi) problems.push('reserved doi');
  if (String(draft.metadata?.prereserve_doi?.recid ?? '') !== String(expect.draftId)) problems.push('reserved recid');
  if (!Array.isArray(draft.metadata?.keywords) || !draft.metadata.keywords.includes(CONCEPT_MARKER)) problems.push('library marker');
  return problems;
}

function errorFields(text) {
  try {
    const body = JSON.parse(text);
    return { error_id: typeof body.error_id === 'string' ? body.error_id : null, message: typeof body.message === 'string' ? body.message : null };
  } catch {
    return { error_id: null, message: null };
  }
}

async function call(doFetch, api, token, method, path) {
  const response = await doFetch(`${api}${path}`, {
    method,
    redirect: 'manual',
    signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'machinerelations-skills-release' },
  });
  const text = await response.text();
  if (response.status >= 300 && response.status < 400) {
    return { status: response.status, json: null, ...errorFields(''), redirected: true };
  }
  let json = null;
  if (text && response.status !== 204) {
    try { json = JSON.parse(text); } catch { json = null; }
  }
  return { status: response.status, json, ...errorFields(text), redirected: false };
}

export async function recoverDraft({
  token, api = 'https://zenodo.org/api', draftId, version, concept, doi, action = 'inspect', fileId = '', fetch: doFetch = fetch,
}) {
  if (!token) return { ok: false, stopped: 'no-token', action };
  if (!/^\d+$/.test(String(draftId))) return { ok: false, stopped: 'bad-draft-id', action };
  let read;
  try {
    read = await call(doFetch, api, token, 'GET', `/deposit/depositions/${draftId}`);
  } catch (error) {
    return { ok: false, stopped: 'read-failed', action, status: null };
  }
  if (read.status === 500) return { ok: false, stopped: 'zenodo-500', action, request: 'GET', status: 500, error_id: read.error_id, message: read.message };
  if (read.redirected || read.status !== 200 || !read.json) return { ok: false, stopped: 'read-failed', action, status: read.status };
  const view = publicView(read.json);
  const problems = assessDraft(read.json, { draftId, version, concept, doi });
  if (action === 'inspect') return { ok: problems.length === 0, action, view, problems };
  if (action !== 'delete-one') return { ok: false, stopped: 'unknown-action', action, view, problems };
  if (problems.length) return { ok: false, stopped: 'not-validated', action, view, problems, mutation: 'not-attempted' };
  let expectedPath;
  try { expectedPath = fileDeletePath(draftId, fileId); } catch { return { ok: false, stopped: 'file-not-on-draft', action, view, mutation: 'not-attempted' }; }
  const listed = (read.json.files ?? []).find((file) => file.id === fileId);
  if (!listed || listed.links?.self !== `${api}${expectedPath}`) {
    return { ok: false, stopped: 'file-not-on-draft', action, view, mutation: 'not-attempted' };
  }
  let removed;
  try {
    removed = await call(doFetch, api, token, 'DELETE', expectedPath);
  } catch {
    return { ok: false, stopped: 'uncertain', action, request: 'DELETE', mutation: 'unknown', view };
  }
  if (removed.status === 204) return { ok: true, action, view, mutation: 'deleted', deleted: fileId };
  return {
    ok: false,
    stopped: removed.status === 500 ? 'zenodo-500' : 'uncertain',
    action,
    request: 'DELETE',
    status: removed.status,
    error_id: removed.error_id,
    message: removed.message,
    view,
    mutation: 'unknown',
  };
}

export function expectedFromCheckout(draftId, root = process.cwd()) {
  return {
    version: readRelease(root).version,
    concept: CONCEPT_DOI.slice(CONCEPT_DOI.lastIndexOf('.') + 1),
    doi: `10.5281/zenodo.${draftId}`,
  };
}

function fromEnv(env) {
  const draftId = env.DRAFT_ID ?? '';
  const expected = expectedFromCheckout(draftId);
  return {
    token: env.ZENODO_TOKEN ?? '',
    api: env.ZENODO_API || 'https://zenodo.org/api',
    draftId,
    version: expected.version,
    concept: expected.concept,
    doi: expected.doi,
    action: env.ACTION || 'inspect',
    fileId: env.FILE_ID ?? '',
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = await recoverDraft(fromEnv(process.env));
  const text = JSON.stringify(result);
  if (process.env.ZENODO_TOKEN && text.includes(process.env.ZENODO_TOKEN)) {
    console.error('refusing to print a result that contains the Zenodo token');
    process.exit(1);
  }
  console.log(text);
  process.exit(result.ok ? 0 : 1);
}
