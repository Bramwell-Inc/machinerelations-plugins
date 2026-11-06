#!/usr/bin/env node
// One check for every site: reads the site's own sitemap, renders one page per page type
// (its fullest and its longest-named page) as people see it and as machines read it, and fails only on hard defects.
// Usage: node page-check.mjs --url <preview> [--base <production>] [--out dir] [--changed files.txt] [--sweep 1500]
// It reads only public pages and holds no credentials. A caller that can reach a protected preview
// (the CI action beside this repository's plugin) passes --access <module> to add its own request headers.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanWords } from './words.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEASURE = fs.readFileSync(path.join(HERE, 'measure.js'), 'utf8');
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] === undefined ? 'true' : all[i + 1]]] : acc), []));
const URL0 = (args.url || process.env.PAGE_CHECK_URL || '').replace(/\/$/, '');
if (!URL0) { console.error('page-check: --url is required'); process.exit(2); }
const BASE = (args.base || process.env.PAGE_CHECK_BASE || '').replace(/\/$/, '');
const OUT = args.out || 'page-check-report';
const MAX_TYPES = Number(args['max-types'] || 18);
const VIEWS = [
  { name: 'phone', width: 390, height: 844, scheme: 'light' },
  { name: 'phone-dark', width: 390, height: 844, scheme: 'dark' },
  { name: 'laptop', width: 1024, height: 768, scheme: 'light' },
  { name: 'wide', width: 1440, height: 900, scheme: 'light' },
  { name: 'wide-dark', width: 1440, height: 900, scheme: 'dark' },
];
fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true });

// No access module: public pages only. With one, it decides which headers go to which host.
const noAccess = { forUrl: async () => ({}), attach: async () => {} };
const access = args.access ? await (await import(pathToFileURL(path.resolve(args.access)).href)).default({ previewUrl: URL0 }) : noAccess;
async function get(url, extra = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'MachineRelationsPageCheck/1 (+https://machinerelations.ai)', ...(await access.forUrl(url)), ...extra }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      const body = await res.text();
      return { status: res.status, type: res.headers.get('content-type') || '', body, url: res.url };
    } catch (e) { if (attempt === 2) return { status: 0, type: '', body: '', error: String(e.message || e) }; }
  }
}

// ---------- 1. Which pages: the site's own map, one sample per page type ----------
async function sitemapUrls(root) {
  const seen = new Set(); const urls = [];
  const queue = [`${root}/sitemap.xml`];
  while (queue.length && seen.size < 40) {
    const sm = queue.shift(); if (seen.has(sm)) continue; seen.add(sm);
    const r = await get(sm); if (r.status !== 200) continue;
    const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, '&'));
    if (/<sitemapindex/i.test(r.body)) locs.forEach((l) => queue.push(onRoot(l, root)));
    else urls.push(...locs);
  }
  return urls;
}
function onRoot(u, root) { try { const x = new URL(u); return root + x.pathname + x.search; } catch { return u; } }
// The site's own URL moved onto the deployment being read; another host (a CDN, a storage bucket) stays where it is.
function onSite(u, root) {
  try {
    const host = new URL(u).host.replace(/^www\./, '');
    const own = [root, BASE].filter(Boolean).map((r) => new URL(r).host.replace(/^www\./, ''));
    return own.includes(host) ? onRoot(u, root) : u;
  } catch { return onRoot(u, root); }
}
function typeOf(p) {
  const segs = p.split('/').filter(Boolean);
  if (!segs.length) return '/';
  return '/' + [segs[0], ...segs.slice(1).map(() => '*')].join('/');
}
function groupPaths(urls) {
  const groups = new Map(); const seen = new Set();
  for (const u of urls) {
    let p; try { p = new URL(u).pathname.replace(/\/$/, '') || '/'; } catch { continue; }
    if (seen.has(p)) continue; seen.add(p);
    const t = typeOf(p);
    if (!groups.has(t)) groups.set(t, []);
    groups.get(t).push(p);
  }
  return groups;
}
// Files this change touches, matched to the site's own URLs by name (content/posts/foo.md -> /blog/foo).
function changedPaths(groups) {
  if (!args.changed || !fs.existsSync(args.changed)) return [];
  const names = new Set();
  for (const f of fs.readFileSync(args.changed, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)) {
    const b = path.basename(f).replace(/\.(mdx?|json|ya?ml|tsx?|jsx?|html?)$/i, '').toLowerCase();
    if (b.length < 4 || /^(index|page|layout|route|data|readme)$/.test(b)) continue;
    names.add(b); names.add(b.replace(/^\d{4}-\d{2}-\d{2}-/, ''));
  }
  const hits = [];
  for (const paths of groups.values()) for (const p of paths) if (names.has(p.split('/').pop().toLowerCase())) hits.push(p);
  return hits.slice(0, 40);
}
function spread(list, n) { if (list.length <= n) return [...list]; const out = []; for (let i = 0; i < n; i += 1) out.push(list[Math.floor((i * list.length) / n)]); return out; }

// ---------- 1b. Sweep: read hundreds of pages as plain HTML (fast, no browser) for printed raw values,
// and learn which page of each type is the biggest and which carries tables or code, so the render goes there.
// Text only, never rendered: drop whole elements until none are left (nested or split tags included).
function dropElements(html, names) {
  const re = new RegExp(`<(${names})\\b[\\s\\S]*?<\\/\\1[^>]*>`, 'gi');
  let prev;
  do { prev = html; html = html.replace(re, ' '); } while (html !== prev);
  return html;
}
function htmlText(html) {
  return dropElements(html, 'script|style|noscript|svg|template|pre|head')
    .replace(/<(code|kbd|samp)\b[\s\S]*?<\/\1>/gi, ' `code` ')
    .replace(/<\/(p|div|li|h\d|td|th|tr|section|article|header|footer|br)>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(nbsp|lt|gt|quot|#x27|#39|amp);/g, (m, e) => ({ nbsp: ' ', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'", amp: '&' })[e])
    .replace(/[ \t]+/g, ' ');
}
async function sweep(root, list) {
  const out = new Map(); const queue = [...list];
  await Promise.all(Array.from({ length: 16 }, async () => {
    while (queue.length) {
      const p = queue.shift();
      const r = await get(root + p);
      if (r.status !== 200 || !/html/.test(r.type)) { out.set(p, { status: r.status, size: 0, rich: false, words: [] }); continue; }
      const body = dropElements(r.body, 'script');
      out.set(p, { status: r.status, size: body.length, rich: /<(table|pre)\b/i.test(body), words: scanWords(htmlText(body)).filter((w) => w.hard) });
    }
  }));
  return out;
}
function samplePaths(groups, swept, changed) {
  // Biggest page types first: that is where a template bug repeats most.
  const types = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_TYPES);
  const picks = new Map();
  for (const [t, paths] of types) {
    const longest = [...paths].sort((a, b) => b.length - a.length)[0];
    picks.set(longest, t); // longest name: where fixed widths break
    // The page with the most on it, preferring one with a table or code block: where long data breaks layouts.
    const seen = paths.filter((p) => swept.get(p)?.status === 200);
    const pool = seen.some((p) => swept.get(p).rich) ? seen.filter((p) => swept.get(p).rich) : seen;
    const fullest = pool.sort((a, b) => swept.get(b).size - swept.get(a).size)[0] || paths[0];
    picks.set(fullest, t);
  }
  picks.set('/', '/');
  for (const p of changed.slice(0, 6)) if (!picks.has(p)) picks.set(p, typeOf(p));
  return [...picks.entries()].map(([p, t]) => ({ path: p, type: t }));
}

// ---------- 2. Machine reader: what AI engines get ----------
async function machineChecks(root, pages) {
  const defects = []; const notes = [];
  const llms = await get(`${root}/llms.txt`);
  if (llms.status !== 200 || llms.body.trim().length < 50 || /<html/i.test(llms.body)) defects.push({ kind: 'llms-txt', detail: `/llms.txt answered ${llms.status}${/<html/i.test(llms.body) ? ' with HTML' : ''}` });
  const robots = await get(`${root}/robots.txt`);
  if (robots.status !== 200) notes.push({ kind: 'robots', detail: `/robots.txt answered ${robots.status}` });
  const miss = await get(`${root}/__page-check-missing__`, { accept: 'text/markdown' });
  if (miss.status !== 404) defects.push({ kind: 'not-found', detail: `a missing page answered ${miss.status}, not 404` });
  else if (!/markdown|text\/plain/.test(miss.type)) notes.push({ kind: 'markdown-404', detail: `missing page asked for Markdown answered ${miss.type}` });
  for (const pg of pages) {
    const where = pg.path;
    const md = await get(root + pg.path, { accept: 'text/markdown' });
    if (md.status === 200 && (!/markdown|text\/plain/.test(md.type) || /^\s*<(!doctype|html)/i.test(md.body))) defects.push({ kind: 'markdown-twin', detail: `asked for Markdown, got ${md.type || 'nothing'}`, where });
    else if (md.status === 200) {
      // Ids belong in a Markdown twin (machines read it; JP and MR layers keep release ids there), printed values do not.
      const words = scanWords(md.body).filter((w) => w.hard && w.kind !== 'raw-id');
      for (const w of words) defects.push({ kind: `markdown-${w.kind}`, detail: `"${w.match}": ${w.why} … ${w.context}`, where });
    }
    // Production pages are not rendered first, so their HTML is fetched here; the og:image check needs it on both sides.
    const html = pg.html || (await get(root + pg.path)).body || '';
    if (!html) continue;
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i);
    const ogUrl = og && og[0].match(/content=["']([^"']+)/i)?.[1];
    if (!ogUrl) defects.push({ kind: 'og-image', detail: 'no og:image', where });
    else if (!pg.ogChecked) {
      const ogAt = onSite(ogUrl.replace(/&amp;/g, '&'), root);
      const img = await fetch(ogAt, { headers: await access.forUrl(ogAt), signal: AbortSignal.timeout(20000) }).catch(() => null);
      if (!img || img.status !== 200 || !/image\//.test(img.headers.get('content-type') || '')) defects.push({ kind: 'og-image', detail: `og:image answered ${img ? img.status : 'nothing'}`, where });
    }
    if (!/<link[^>]+rel=["']canonical["']/i.test(html)) notes.push({ kind: 'canonical', detail: 'no canonical link', where });
    for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
      try { JSON.parse(m[1]); } catch { defects.push({ kind: 'schema', detail: 'JSON-LD does not parse', where }); }
    }
    if (pg.path === '/' && !/"@type"\s*:\s*"(Organization|Person|Corporation|NewsMediaOrganization|ProfessionalService)"/.test(html)) notes.push({ kind: 'schema', detail: 'home page has no Organization or Person schema', where });
  }
  return { defects, notes };
}

// ---------- 3. Human reader: render and measure ----------
async function launch() {
  const { chromium } = await import('playwright');
  const opts = { headless: true };
  if (process.env.CHROMIUM_PATH) opts.executablePath = process.env.CHROMIUM_PATH;
  else { try { const sc = (await import('@sparticuz/chromium')).default; opts.executablePath = await sc.executablePath(); opts.args = sc.args.filter((a) => !['--single-process', '--no-zygote'].includes(a)); } catch { /* use Playwright's own browser */ } }
  return chromium.launch(opts);
}

async function renderAll(browser, root, pages, { shots = true } = {}) {
  const results = [];
  const { default: AxeBuilder } = await import('@axe-core/playwright');
  const queue = pages.flatMap((pg) => VIEWS.map((v) => ({ pg, v })));
  const svgSeen = new Set();
  async function worker() {
    while (queue.length) {
      const { pg, v } = queue.shift();
      const ctx = await browser.newContext({ viewport: { width: v.width, height: v.height }, colorScheme: v.scheme, deviceScaleFactor: 1, isMobile: v.width < 500, hasTouch: v.width < 500 });
      await access.attach(ctx, root);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
      const r = { path: pg.path, type: pg.type, view: v.name, defects: [], notes: [] };
      try {
        const res = await page.goto(root + pg.path, { waitUntil: 'networkidle', timeout: 45000 }).catch(async () => page.goto(root + pg.path, { waitUntil: 'load', timeout: 45000 }));
        if (!res || res.status() >= 400) r.defects.push({ kind: 'http', detail: `page answered ${res ? res.status() : 'nothing'}` });
        if (v.name === 'wide' && !pg.html) pg.html = await page.content();
        await page.evaluate(() => document.fonts && document.fonts.ready);
        // Lazy content: scroll through once, then back to the top.
        await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 800) { window.scrollTo(0, y); await new Promise((ok) => setTimeout(ok, 40)); } window.scrollTo(0, 0); });
        await page.waitForTimeout(300);
        // Let entrance animations and fades finish (looping ones are capped), so a half-faded heading is not judged.
        await page.evaluate(() => Promise.race([Promise.all(document.getAnimations().filter((a) => a.effect?.getTiming?.().iterations !== Infinity).map((a) => a.finished.catch(() => {}))), new Promise((ok) => setTimeout(ok, 2500))]));
        const m = await page.evaluate(`(${MEASURE})()`);
        r.defects.push(...m.defects); r.notes.push(...m.notes);
        if (v.name === 'wide') {
          const text = await page.evaluate(() => { const c = document.body.cloneNode(true); c.querySelectorAll('pre,script,style,noscript,[aria-hidden=true]').forEach((n) => n.remove()); c.querySelectorAll('code,kbd,samp').forEach((n) => n.replaceWith('`code`')); document.body.appendChild(c); c.style.cssText = 'position:absolute;left:-99999px;top:0;width:1200px'; const t = c.innerText; c.remove(); return t; });
          for (const w of scanWords(text)) (w.hard ? r.defects : r.notes).push({ kind: w.kind, detail: `"${w.match}": ${w.why} … ${w.context}` });
          const ax = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).disableRules(['region', 'color-contrast']).analyze().catch(() => null);
          for (const vi of ax?.violations || []) (['critical', 'serious'].includes(vi.impact) ? r.defects : r.notes).push({ kind: `a11y:${vi.id}`, detail: `${vi.help} (${vi.nodes.length})`, where: vi.nodes[0]?.target?.join(' ') });
          // Generated images: every same-site SVG is opened on its own and its text measured against its box.
          const svgs = await page.evaluate((origin) => [...document.images].map((i) => i.currentSrc || i.src).filter((s) => s.startsWith(origin) && /\.svg(\?|$)|\/badge|\/embed/.test(s)), new URL(root).origin);
          for (const s of svgs) if (!svgSeen.has(s.split('?')[0]) && svgSeen.size < 12) { svgSeen.add(s.split('?')[0]); r.defects.push(...await checkSvg(ctx, s)); }
        }
        if (v.name === 'wide' || v.name === 'wide-dark') {
          // Text contrast in light and dark, measured from styles rather than by axe: axe gives up ("incomplete") on any text
          // above a CSS gradient, and most of these sites paint a dot grid on the page, so axe judged almost nothing.
          // A gradient with a see-through stop (a pattern or a fade) is decoration over the colour beneath it; a solid
          // gradient is judged against its kindest stop, so only text that fails on every part of it counts. Text over a
          // photo or other image is skipped: its contrast can't be read from styles.
          const low = await page.evaluate(() => {
            const parse = (c) => { const n = (c.match(/[\d.]+/g) || []).map(Number); return /^color\(srgb/.test(c) ? [n[0] * 255, n[1] * 255, n[2] * 255, n[3] ?? 1] : [n[0], n[1], n[2], n[3] ?? 1]; };
            const lum = (c) => { const [r1, g, b] = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r1 + 0.7152 * g + 0.0722 * b; };
            const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
            const over = (fg, bg) => (fg[3] < 1 ? fg.slice(0, 3).map((x, i) => x * fg[3] + bg[i] * (1 - fg[3])).concat(1) : fg);
            const hex = (c) => '#' + c.slice(0, 3).map((x) => Math.round(x).toString(16).padStart(2, '0')).join('');
            const stops = (img) => (img.match(/(rgba?|color)\([^)]*\)/g) || []).map(parse);
            const pairs = new Map();
            for (const el of document.querySelectorAll('body *')) {
              if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'svg'].includes(el.tagName)) continue;
              if (![...el.childNodes].some((n) => n.nodeType === 3 && /[\p{L}\p{N}]/u.test(n.textContent))) continue;
              const r = el.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
              if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue;
              if (el.closest('[aria-hidden=true],[inert],[disabled],:disabled')) continue;
              let p = el; let bgs = null; let skip = false; let alpha = 1;
              for (let q = el; q; q = q.parentElement) alpha *= Number(getComputedStyle(q).opacity);
              while (p) {
                const cs = getComputedStyle(p); const c = parse(cs.backgroundColor);
                if (cs.backgroundImage !== 'none') {
                  if (/url\(/.test(cs.backgroundImage)) { skip = true; break; }
                  const st = stops(cs.backgroundImage);
                  if (st.length && st.every((x) => x[3] > 0.5)) { bgs = st; break; }
                }
                if (c[3] > 0.5) { bgs = [c]; break; }
                p = p.parentElement;
              }
              if (skip) continue;
              if (!bgs) bgs = [[255, 255, 255, 1]];
              const cs = getComputedStyle(el); const size = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
              const need = size >= 24 || (size >= 18.66 && bold) ? 3 : 4.5;
              let fg = parse(cs.color); fg = [fg[0], fg[1], fg[2], fg[3] * alpha];
              let best = 0; let bgUsed = bgs[0];
              for (const b of bgs) { const k = ratio(over(fg, b), b); if (k > best) { best = k; bgUsed = b; } }
              if (best >= need) continue;
              const key = hex(over(fg, bgUsed)) + ' on ' + hex(bgUsed);
              const e = pairs.get(key) || { n: 0, ratio: best, need, where: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ' "' + el.textContent.trim().slice(0, 40) + '"' };
              e.n += 1; pairs.set(key, e);
            }
            return [...pairs].map(([key, e]) => ({ key, ...e }));
          });
          // One finding per colour pair: one token or rule causes all of its hits, so one fix clears it.
          for (const x of low) r.defects.push({ kind: 'contrast', detail: `${x.n} text element(s) at ${x.ratio.toFixed(2)}:1, ${x.key}; needs ${x.need}:1`, where: x.where, pair: x.key });
        }
        if (errors.length) r.notes.push({ kind: 'script-error', detail: errors.slice(0, 2).join(' | ') });
        if (shots) { const f = `${slug(pg.path)}--${v.name}.png`; await page.screenshot({ path: path.join(OUT, 'shots', f), fullPage: false }); r.shot = f; }
      } catch (e) {
        r.defects.push({ kind: 'render', detail: `could not render: ${String(e.message || e).slice(0, 160)}` });
      }
      await ctx.close().catch(() => {});
      results.push(r);
    }
  }
  await Promise.all(Array.from({ length: Number(args.workers || 4) }, worker));
  // A dark-view contrast pair the light view of the same page also reported is text dark mode leaves unchanged
  // (a site with no dark theme): one problem, reported once.
  const light = new Map(results.filter((r) => r.view === 'wide').map((r) => [r.path, new Set(r.defects.filter((d) => d.kind === 'contrast').map((d) => d.pair))]));
  for (const r of results) if (r.view === 'wide-dark') r.defects = r.defects.filter((d) => d.kind !== 'contrast' || !light.get(r.path)?.has(d.pair));
  return results;
}

async function checkSvg(ctx, src) {
  const page = await ctx.newPage();
  const out = [];
  try {
    await page.goto(src, { waitUntil: 'load', timeout: 20000 });
    const res = await page.evaluate(() => {
      const svg = document.querySelector('svg'); if (!svg) return null;
      const vb = svg.viewBox?.baseVal; const w = vb && vb.width ? vb.width : svg.width.baseVal.value; const h = vb && vb.height ? vb.height : svg.height.baseVal.value;
      const x0 = vb ? vb.x : 0; const y0 = vb ? vb.y : 0;
      const bad = [];
      for (const t of svg.querySelectorAll('text')) {
        const b = t.getBBox();
        // Walk up for clip paths / nested boxes: a text clipped by its own rect counts too.
        let limit = { x: x0, y: y0, w, h };
        const clip = t.closest('[clip-path]');
        if (clip) { const id = clip.getAttribute('clip-path').match(/#([^)]+)/)?.[1]; const r = id && document.getElementById(id)?.querySelector('rect'); if (r) limit = { x: r.x.baseVal.value, y: r.y.baseVal.value, w: r.width.baseVal.value, h: r.height.baseVal.value }; }
        if (b.x < limit.x - 1 || b.x + b.width > limit.x + limit.w + 1) bad.push(t.textContent.trim().slice(0, 40));
      }
      return bad;
    });
    if (res && res.length) out.push({ kind: 'clipped-image-text', detail: `${res.length} line(s) cut off in a generated image: "${res[0]}"`, where: src.replace(/^https?:\/\/[^/]+/, '') });
  } catch { /* not an SVG document */ }
  await page.close();
  return out;
}

async function links(root, pages) {
  const defects = []; const all = new Set();
  for (const pg of pages) for (const m of (pg.html || '').matchAll(/href=["'](\/[^"'#?]*)/g)) all.add(m[1]);
  const list = [...all].filter((p) => !/\.(png|jpe?g|svg|webp|ico|xml|txt|json|md|pdf|css|js)$/i.test(p) && !p.startsWith('/_next')).slice(0, 150);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (list.length) {
      const p = list.shift();
      const r = await get(root + p);
      // A link that hands off to another site (a redirect out) is that site's to answer; a rate limit is not a broken page.
      const offsite = r.url && new URL(r.url).origin !== new URL(root).origin;
      if ((r.status >= 400 && r.status !== 429 && !offsite) || r.status === 0) defects.push({ kind: 'broken-link', detail: `${p} answered ${r.status || r.error}`, where: p });
    }
  }));
  return { defects, checked: all.size };
}

const slug = (p) => (p === '/' ? 'home' : p.replace(/^\//, '').replace(/[^\w.-]+/g, '_').slice(0, 80));
// A contrast finding is its colour pair: which element shows it first changes with content, the pair only with design.
const sig = (d, r) => d.kind === 'contrast' ? `${r?.type ?? ''}|${r?.view ?? ''}|contrast|${d.pair}` : `${r?.type ?? ''}|${r?.view ?? ''}|${d.kind}|${(d.where || '').replace(/"[^"]*"/, '')}|${d.kind.startsWith('a11y') || d.kind === 'small-text' || d.kind === 'small-target' ? '' : d.detail.replace(/\d+/g, '#')}`;

// ---------- run ----------
const t0 = Date.now();
const urls = await sitemapUrls(URL0);
const groups = groupPaths(urls);
const urlCount = urls.length; const typeCount = groups.size;
const changed = changedPaths(groups);
// Every page type gets read; big types get more pages, up to SWEEP pages in all.
const SWEEP = Number(args.sweep || 1500);
const total = [...groups.values()].reduce((n, g) => n + g.length, 0) || 1;
const sweepList = [...new Set([...changed, ...[...groups.values()].flatMap((g) => spread(g, Math.max(Math.min(g.length, 8), Math.floor((SWEEP * g.length) / total))))])];
const swept = await sweep(URL0, sweepList);
let picks = urlCount ? samplePaths(groups, swept, changed) : [{ path: '/', type: '/' }];
const sweepDefects = [];
for (const [p, s] of swept) for (const w of s.words) sweepDefects.push({ kind: w.kind, detail: `"${w.match}": ${w.why} … ${w.context}`, where: p, sweepMatch: w.match });
const browser = await launch();
const rendered = await renderAll(browser, URL0, picks);
const machine = await machineChecks(URL0, picks);
const linkCheck = await links(URL0, picks);

// Compare with production: block only what this change adds. What production already shows is reported, never blocking.
let baseSigs = null; const baseSweepSigs = new Set();
if (BASE) {
  const flagged = picks.filter((pg) => rendered.some((r) => r.path === pg.path && r.defects.length));
  const baseRendered = flagged.length ? await renderAll(browser, BASE, flagged.map((p) => ({ ...p, html: undefined })), { shots: false }) : [];
  const baseMachine = await machineChecks(BASE, picks.map((p) => ({ ...p, html: undefined })));
  const baseLinks = await links(BASE, picks);
  const flaggedSweep = [...new Set(sweepDefects.map((d) => d.where))];
  const baseSwept = flaggedSweep.length ? await sweep(BASE, flaggedSweep) : new Map();
  for (const [p, s] of baseSwept) for (const w of s.words) baseSweepSigs.add(`${p}|${w.match}`);
  baseSigs = new Set([
    ...baseRendered.flatMap((r) => r.defects.map((d) => sig(d, r))),
    ...baseMachine.defects.map((d) => sig(d)),
    ...baseLinks.defects.map((d) => sig(d)),
  ]);
}
await browser.close();

const hard = [];
for (const r of rendered) for (const d of r.defects) hard.push({ ...d, path: r.path, type: r.type, view: r.view, shot: r.shot, known: baseSigs ? baseSigs.has(sig(d, r)) : false });
// A raw value already printed on production is that page's old problem, not this change's.
for (const d of sweepDefects) if (!rendered.some((r) => r.path === d.where && r.defects.some((x) => x.detail === d.detail))) hard.push({ ...d, path: d.where, type: typeOf(d.where), view: 'html', known: baseSigs ? baseSweepSigs.has(`${d.where}|${d.sweepMatch}`) : false });
for (const d of [...machine.defects, ...linkCheck.defects]) hard.push({ ...d, path: d.where, type: 'machine', view: 'machine', known: baseSigs ? baseSigs.has(sig(d)) : false });
// A rendered problem blocks only if it shows again on a second look at the preview and on neither look at production:
// fonts, fades and late scripts make one render a sample, not a verdict.
if (BASE) {
  const suspects = hard.filter((d) => !d.known && d.view !== 'html' && d.view !== 'machine');
  if (suspects.length) {
    const pages = picks.filter((pg) => suspects.some((d) => d.path === pg.path)).map((p) => ({ ...p, html: undefined }));
    const browser2 = await launch();
    const again = await renderAll(browser2, URL0, pages, { shots: false });
    const baseAgain = await renderAll(browser2, BASE, pages, { shots: false });
    await browser2.close();
    const seenAgain = new Set(again.flatMap((r) => r.defects.map((x) => sig(x, r))));
    const onBase = new Set(baseAgain.flatMap((r) => r.defects.map((x) => sig(x, r))));
    for (const d of suspects) {
      const k = sig(d, d);
      if (onBase.has(k)) d.known = true;
      else if (!seenAgain.has(k)) { d.known = true; d.flaky = true; }
    }
  }
}
const notes = [...rendered.flatMap((r) => r.notes.map((n) => ({ ...n, path: r.path, view: r.view }))), ...machine.notes, ...hard.filter((d) => d.flaky).map((d) => ({ ...d, kind: `unsteady:${d.kind}`, detail: `${d.detail} (seen once, not on a second render)` }))];
for (let i = hard.length - 1; i >= 0; i -= 1) if (hard[i].flaky) hard.splice(i, 1);
const blocking = hard.filter((d) => !d.known);
const seconds = Math.round((Date.now() - t0) / 1000);
const report = { url: URL0, base: BASE || null, seconds, urlCount, typeCount, swept: swept.size, changed: changed.length, sampled: picks.length, renders: rendered.length, linksChecked: linkCheck.checked, blocking, known: hard.filter((d) => d.known), notes };
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

// Markdown for the pull request: what blocks, grouped so one template bug reads as one line.
function group(list) {
  const g = new Map();
  for (const d of list) { const k = d.where && !String(d.kind).match(/^(raw|bad|markdown|broken|http|og|schema|llms|not-found|clipped-image)/) ? `${d.kind}|${String(d.where).replace(/"[^"]*"/g, '')}` : `${d.kind}|${d.type}|${(d.detail || '').replace(/\d+/g, '#').slice(0, 90)}`; if (!g.has(k)) g.set(k, { ...d, views: new Set(), paths: new Set() }); g.get(k).views.add(d.view); g.get(k).paths.add(d.path); g.get(k).types = (g.get(k).types || new Set()).add(d.type); }
  return [...g.values()];
}
const lines = [];
lines.push(blocking.length ? `**Page check: ${group(blocking).length} problem(s) this change adds.** Fix these before merging.` : `**Page check: clean.** ${swept.size} pages read, ${picks.length} rendered across ${typeCount} page types (${rendered.length} renders), ${linkCheck.checked} links, in ${seconds}s.`);
for (const d of group(blocking).slice(0, 25)) lines.push(`- **${d.kind}** on \`${[...d.paths][0] || '/'}\`${d.paths.size > 1 ? ` and ${d.paths.size - 1} more page(s)` : ''} (${[...d.views].join(', ')}): ${d.detail}${d.where ? ` at \`${String(d.where).slice(0, 120)}\`` : ''}`);
const known = group(hard.filter((d) => d.known));
if (known.length) { lines.push('', `<details><summary>${known.length} problem(s) production already has (not blocking)</summary>`, ''); for (const d of known.slice(0, 30)) lines.push(`- ${d.kind} on \`${[...d.paths][0] || '/'}\` (${[...d.views].join(', ')}): ${d.detail}`); lines.push('', '</details>'); }
const ng = [...new Map(notes.map((n) => [`${n.kind}|${n.path}`, n])).values()];
if (ng.length) { lines.push('', `<details><summary>${ng.length} note(s) worth a look (never blocking)</summary>`, ''); for (const d of ng.slice(0, 30)) lines.push(`- ${d.kind} on \`${d.path || '/'}\`: ${d.detail}`); lines.push('', '</details>'); }
lines.push('', `<sub>Sampled from the site's own sitemap (${urlCount} URLs, ${typeCount} page types): ${swept.size} pages read as HTML for printed raw values; per page type its fullest page and its longest-named page${changed.length ? `, plus ${Math.min(changed.length, 6)} page(s) this change edits` : ''} rendered at 390, 1024 and 1440 wide, light and dark. How to read and fix: the page-check skill's reference (references/how-it-works.md).</sub>`);
fs.writeFileSync(path.join(OUT, 'summary.md'), lines.join('\n') + '\n');
console.log(lines.join('\n'));
process.exit(blocking.length ? 1 : 0);
