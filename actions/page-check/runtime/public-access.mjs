// Separate production acceptance: never subtract these findings against a preview baseline.
export async function publicAccess(root, pages, { fetcher = fetch, maxMaps = 40, maxDataDocuments = 10, maxLinkedDocuments = 16 } = {}) {
  if (!root) return { status: 'not-tested', reason: 'No production origin supplied.', checks: [], findings: [] };
  const origin = new URL(root).origin;
  const deadline = AbortSignal.timeout(120000);
  const dataDocuments = new Set();
  function discoverData(value, base = origin) {
    try {
      const url = new URL(value.replaceAll('&amp;', '&'), base);
      if (url.origin === origin && !url.username && !url.password && /\.json$/i.test(url.pathname) && !url.search) {
        url.hash = ''; dataDocuments.add(url.href);
      }
    } catch { /* Not a public same-origin JSON document. */ }
  }
  function discoverDataLinks(body, base) {
    for (const match of body.matchAll(/(?:href=["']|\]\()([^"'\s)]+)["')]/g)) discoverData(match[1], base);
  }
  // Advertised machine documents that are not pages: the homepage's Link header and the root-level or
  // /.well-known/ documents llms.txt links. A new route advertised here but denied at the edge is a finding.
  const linkedDocuments = new Map();
  const presentationRel = /^(?:preload|modulepreload|prefetch|preconnect|dns-prefetch|stylesheet|icon|apple-touch-icon|manifest|canonical)$/i;
  // kind: 'html' for a declared text/html target, 'any' for an untyped Link target, otherwise 'doc' (never an HTML page).
  // Header targets are probed first, then /.well-known/, then other llms.txt documents, so the bound drops the least specific.
  function discoverDocument(value, base, kind = 'doc', rank = 2) {
    try {
      const url = new URL(value.replaceAll('&amp;', '&'), base);
      if (url.origin !== origin || url.username || url.password || url.search) return;
      url.hash = '';
      if (/\.json$/i.test(url.pathname)) { dataDocuments.add(url.href); return; }
      if (['/', '/robots.txt', '/llms.txt', '/sitemap.xml'].includes(url.pathname)) return;
      if (/^\/\.well-known\//.test(url.pathname)) rank = Math.min(rank, 1);
      if (!linkedDocuments.has(url.href) || linkedDocuments.get(url.href).rank > rank) linkedDocuments.set(url.href, { kind, rank });
    } catch { /* Not a public same-origin document. */ }
  }
  function discoverLinkHeader(header, base) {
    for (const match of (header || '').matchAll(/<([^>]+)>([^,<]*)/g)) {
      const rels = (/\brel="?([^";]+)"?/i.exec(match[2])?.[1] || '').trim().split(/\s+/).filter(Boolean);
      if (!rels.length || rels.every(rel => presentationRel.test(rel))) continue;
      const type = (/\btype="?([^";]+)"?/i.exec(match[2])?.[1] || '').trim().toLowerCase();
      discoverDocument(match[1], base, type === 'text/html' ? 'html' : type ? 'doc' : 'any', 0);
    }
  }
  function discoverTextDocuments(body, base) {
    for (const match of body.matchAll(/\]\(([^)\s]+)\)/g)) {
      let path = ''; try { path = new URL(match[1], base).pathname; } catch { continue; }
      if (/^\/\.well-known\//.test(path) || /^\/[^/]+\.(?:md|cff|xml|txt|ya?ml)$/i.test(path)) discoverDocument(match[1], base);
    }
  }
  const checks = []; const findings = []; const published = new Set(); const representatives = new Map(); const maps = new Set(); const queue = [origin + '/sitemap.xml'];
  const clients = { named: 'MachineRelationsPageCheck/1 (+https://machinerelations.ai)', standardUa: 'Python-urllib/3.11' };
  async function request(url, method, client, kind) {
    const record = { url, method, client, kind }; let res;
    try {
      deadline.throwIfAborted();
      let at = url;
      for (let n = 0; n < 6; n++) {
        res = await fetcher(at, { method, headers: { 'user-agent': clients[client], ...(kind === 'json' && method === 'GET' ? { range: 'bytes=0-65535' } : {}) }, redirect: 'manual', signal: AbortSignal.any([deadline, AbortSignal.timeout(20000)]) });
        if (![301, 302, 303, 307, 308].includes(res.status)) break;
        const location = res.headers.get('location');
        if (!location) throw Error('redirect has no Location');
        const next = new URL(location, at);
        await res.body?.cancel();
        if (next.origin !== origin) throw Error('redirect left production origin');
        if (next.username || next.password || (kind === 'json' && next.search)) throw Error('redirect requires credentials or a JSON query');
        at = next.href;
      }
      record.status = res.status; record.type = res.headers.get('content-type') || '';
      if (res.status !== 200 && !(kind === 'json' && method === 'GET' && res.status === 206)) throw Error(`HTTP ${res.status}`);
      if (kind === 'xml' && /gzip|octet-stream/i.test(record.type)) { record.incomplete = true; throw Error('compressed or binary sitemap not inspected'); }
      if (kind === 'any' ? false : kind === 'doc' ? /^\s*text\/html\b/i.test(record.type) : !(kind === 'xml' ? /(?:application|text)\/xml/i : kind === 'text' ? /text\/plain/i : kind === 'json' ? /application\/(?:[a-z0-9.-]+\+)?json\b/i : /text\/html/i).test(record.type)) throw Error(`unexpected content type: ${record.type}`);
      let body = '';
      if (method === 'GET') {
        const reader = res.body.getReader(); const decoder = new TextDecoder(); let size = 0;
        const limit = kind === 'xml' ? 16 * 1024 * 1024 : 65536;
        try {
          while (true) {
            const chunk = await reader.read(); if (chunk.done) break;
            size += chunk.value.length;
            if (size > limit && kind === 'xml') { record.incomplete = true; throw Error('sitemap exceeds read bound'); }
            body += decoder.decode(chunk.value.subarray(0, Math.max(0, chunk.value.length - Math.max(0, size - limit))), { stream: true });
            if (size >= limit) break;
          }
          body += decoder.decode();
        } finally { await reader.cancel(); }
        if (!body.trim() || (kind !== 'json' && /cf-chl-|<title>\s*(?:just a moment|attention required)|error code: 1010/i.test(body))) throw Error('empty body or challenge');
        if (kind !== 'html' && kind !== 'json' && kind !== 'any' && /<(?:!doctype\s+html|html)\b/i.test(body)) throw Error('HTML instead of discovery document');
        if (kind === 'json' && !/^[\s]*[\[{]/.test(body)) throw Error('JSON document has no object or array prefix');
        if (client === 'named' && (kind === 'html' || kind === 'text')) discoverDataLinks(body, at);
        if (client === 'named' && kind === 'text' && new URL(at).pathname === '/llms.txt') discoverTextDocuments(body, at);
        if (client === 'named' && kind === 'html' && new URL(at).pathname === '/') discoverLinkHeader(res.headers.get('link'), at);
        if (kind === 'xml' && !(/<sitemapindex\b[\s\S]*<\/sitemapindex>\s*$/i.test(body) || /<urlset\b[\s\S]*<\/urlset>\s*$/i.test(body))) throw Error('incomplete or unrecognized sitemap');
      }
      record.ok = true; checks.push(record); return body;
    } catch (error) { await res?.body?.cancel().catch(() => {}); record.ok = false; if (deadline.aborted) record.incomplete = true; record.detail = String(error.message || error); checks.push(record); findings.push(record); return null; }
  }
  async function probe(url, kind) {
    const rows = await Promise.all(Object.keys(clients).flatMap(client => ['GET', 'HEAD'].map(method => request(url, method, client, kind))));
    return rows[0]; // Named GET supplies discovery; a blocked standard UA remains a separate finding.
  }
  await probe(origin + '/robots.txt', 'text'); await probe(origin + '/llms.txt', 'text');
  while (queue.length) {
    if (deadline.aborted) { findings.push({ kind: 'discovery', detail: 'production access time bound exhausted; coverage incomplete', incomplete: true, ok: false }); break; }
    const url = queue.shift(); if (maps.has(url)) continue;
    if (maps.size >= maxMaps) { findings.push({ kind: 'discovery', url, detail: 'sitemap traversal bound exhausted', incomplete: true, ok: false }); break; }
    maps.add(url); const body = await probe(url, 'xml');
    if (body && /<sitemapindex\b/i.test(body)) {
      const children = [...body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)];
      if (!children.length) findings.push({ kind: 'discovery', url, detail: 'sitemap index contains no child locations', ok: false });
      for (const match of children) {
        try {
          const child = new URL(match[1].replaceAll('&amp;', '&'), url);
          if (child.origin !== origin || child.username || child.password) throw Error('child sitemap left production origin');
          queue.push(child.href);
        } catch (error) { findings.push({ kind: 'discovery', url, detail: String(error.message), ok: false }); }
      }
    } else if (body) {
      for (const match of body.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)) {
        try {
          const page = new URL(match[1].replaceAll('&amp;', '&'), url);
          if (page.origin !== origin || page.username || page.password) continue;
          const p = page.pathname.replace(/\/$/, '') || '/';
          if (/\.json$/i.test(p)) discoverData(page.href);
          // Data documents are probed separately, never as HTML pages.
          if (/\.(?:json|xml|txt|csv|pdf|png|jpe?g|svg|webp|gz)$/i.test(p)) continue;
          published.add(p);
          const parts = p.split('/').filter(Boolean); const type = '/' + parts.map((x, i) => i ? '*' : x).join('/');
          if (!representatives.has(type)) representatives.set(type, p);
        } catch { /* An invalid content URL is not a new request target. */ }
      }
    }
  }
  const existingPicks = pages.map(p => p.path).filter(p => published.has(p.replace(/\/$/, '') || '/'));
  const omittedPreviewPaths = pages.map(p => p.path).filter(p => p !== '/' && !existingPicks.includes(p));
  const paths = [...new Set(['/', ...existingPicks, ...representatives.values()])].slice(0, 40);
  let sampledPages = 0;
  for (const p of paths) {
    if (deadline.aborted) { findings.push({ kind: 'page', detail: 'production access time bound exhausted; coverage incomplete', incomplete: true, ok: false }); break; }
    const url = new URL(p, origin);
    if (url.origin !== origin) { findings.push({ kind: 'page', detail: 'sample left production origin', ok: false }); continue; }
    sampledPages++; await probe(url.href, 'html');
  }
  let sampledLinkedDocuments = 0;
  for (const [url, { kind }] of [...linkedDocuments].sort((a, b) => a[1].rank - b[1].rank)) {
    if (deadline.aborted || sampledLinkedDocuments >= maxLinkedDocuments) {
      findings.push({ kind: 'doc', detail: 'advertised discovery document bound exhausted; coverage incomplete', incomplete: true, ok: false }); break;
    }
    sampledLinkedDocuments++; await probe(url, kind);
  }
  let sampledDataDocuments = 0;
  for (const url of dataDocuments) {
    if (deadline.aborted || sampledDataDocuments >= maxDataDocuments) {
      findings.push({ kind: 'json', detail: 'advertised JSON access bound exhausted; coverage incomplete', incomplete: true, ok: false }); break;
    }
    sampledDataDocuments++; await probe(url, 'json');
  }
  return { status: findings.length ? findings.every(f => f.incomplete) ? 'incomplete' : 'failed' : 'passed', origin, omittedPreviewPaths, sampledPages, sampledDataDocuments, sampledLinkedDocuments, sitemapDocuments: maps.size, checks, findings,
    scope: 'Credential-free Node GET/HEAD with named and Python-urllib user-agent headers; JSON GETs inspect at most 64 KiB of advertised same-origin documents, not complete JSON validity; other discovery documents are the homepage Link header targets and the root-level or /.well-known/ files llms.txt links. Not actual Python transport, all pages/data, or a crawler/indexing claim.' };
}

export function publicAccessSummary(result) {
  if (result.status === 'not-tested') return `**Production machine access: not tested.** ${result.reason}`;
  return `**Production machine access: ${result.status}.** ${result.checks.filter(c => c.ok).length}/${result.checks.length} HTTP checks passed; ${result.findings.length} finding(s); ${result.sitemapDocuments} sitemap documents and ${result.sampledPages} sampled pages; ${result.sampledDataDocuments || 0} advertised JSON documents; ${result.sampledLinkedDocuments || 0} other advertised discovery documents. ${result.omittedPreviewPaths.length} preview sample(s) not found in the inspected production sitemap coverage were not probed. This is separate from whether this PR introduces a defect. ${result.scope}`;
}

export function publicAccessDetails(result) {
  const groups = new Map();
  for (const f of result.findings) {
    const key = `${f.url || ''}|${f.detail}`;
    if (!groups.has(key)) groups.set(key, { ...f, probes: [] });
    if (f.method) groups.get(key).probes.push(`${f.client}/${f.method}`);
  }
  const rows = [...groups.values()];
  const lines = rows.slice(0, 12).map(f => `- Production access: ${f.url || f.kind}: ${f.detail}${f.probes.length ? ` (${f.probes.join(', ')})` : ''}`);
  if (rows.length > 12) lines.push(`- ${rows.length - 12} more grouped production-access finding(s); full evidence is in report.json.`);
  return lines;
}
