// Runs inside the rendered page. Returns hard defects and notes for one viewport.
// No imports: Playwright passes this function to page.evaluate.
() => {
  const W = window.innerWidth;
  const out = { defects: [], notes: [] };
  const add = (list, kind, detail, el) => list.push({ kind, detail, where: el ? describe(el) : undefined });

  function describe(el) {
    if (!el || !el.tagName) return '';
    const parts = [];
    let node = el;
    for (let i = 0; node && node.tagName && i < 4; i += 1) {
      let s = node.tagName.toLowerCase();
      if (node.id) { s += `#${node.id}`; parts.unshift(s); break; }
      const cls = [...node.classList].filter((c) => /^[a-z][\w-]{1,24}$/i.test(c) && !/\d{3,}/.test(c)).slice(0, 2);
      if (cls.length) s += `.${cls.join('.')}`;
      parts.unshift(s);
      node = node.parentElement;
    }
    const text = (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 50);
    return parts.join(' > ') + (text ? ` "${text}"` : '');
  }

  function visible(el) {
    if (!el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    // Screen-reader-only text is meant to be invisible.
    if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return false;
    let p = el;
    while (p && p !== document.body) {
      const ps = getComputedStyle(p);
      if (ps.display === 'none' || ps.visibility === 'hidden' || Number(ps.opacity) === 0) return false;
      if (p.getAttribute('aria-hidden') === 'true' && p.closest('[inert]')) return false;
      if (p.tagName === 'DETAILS' && !p.open && !el.closest('summary')) return false;
      p = p.parentElement;
    }
    return true;
  }

  function scrollsX(el) {
    for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      const ox = getComputedStyle(p).overflowX;
      if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
    }
    return false;
  }

  // 1. Page wider than the screen.
  const sw = document.scrollingElement.scrollWidth;
  if (sw > W + 1) {
    const culprits = [];
    for (const el of document.body.querySelectorAll('*')) {
      const r = el.getBoundingClientRect();
      if (r.right > W + 1 && r.width > 0 && !scrollsX(el) && visible(el)) {
        if (!culprits.some((c) => c.contains(el))) culprits.push(el);
        if (culprits.length > 3) break;
      }
    }
    add(out.defects, 'overflow', `page is ${sw}px wide on a ${W}px screen${culprits.length ? '' : ''}`, culprits[0]);
  }

  // 2. Text cut off by its own box (no ellipsis, no line clamp: the reader has no way back).
  const textEls = [...document.body.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,a,button,span,td,th,dt,dd,label,figcaption,blockquote,summary')]
    .filter((el) => el.childElementCount === 0 || [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  for (const el of textEls) {
    if (!el.textContent.trim() || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const clipsX = ['hidden', 'clip'].includes(cs.overflowX) && cs.textOverflow !== 'ellipsis' && cs.whiteSpace !== 'normal';
    const clipsY = ['hidden', 'clip'].includes(cs.overflowY) && !cs.webkitLineClamp?.match?.(/\d/) && cs.getPropertyValue('-webkit-line-clamp') === 'none';
    if ((clipsX && el.scrollWidth > el.clientWidth + 2) || (clipsY && el.scrollHeight > el.clientHeight + 4 && el.clientHeight > 0)) {
      add(out.defects, 'clipped-text', 'text is cut off by its box', el);
    }
  }

  // 3. Text lines that run past the screen edge (inside a non-scrolling parent).
  // 4. Overlap: real glyph boxes against other glyph boxes and controls.
  const clipCache = new Map();
  function clipOf(el) {
    if (clipCache.has(el)) return clipCache.get(el);
    let box = null;
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || cs.webkitLineClamp !== 'none' && cs.webkitLineClamp) { box = p.getBoundingClientRect(); break; }
    }
    clipCache.set(el, box); return box;
  }
  const lines = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  const visCache = new Map();
  const isVis = (el) => { if (!visCache.has(el)) visCache.set(el, visible(el)); return visCache.get(el); };
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'OPTION'].includes(el.tagName) || el.closest('svg')) continue;
    if (!isVis(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    // Lines a clipping box hides (line-clamp, overflow hidden) are not painted: cut each line to that box.
    const clipBox = clipOf(el);
    for (const r0 of range.getClientRects()) {
      const r = clipBox ? { left: Math.max(r0.left, clipBox.left), right: Math.min(r0.right, clipBox.right), top: Math.max(r0.top, clipBox.top), bottom: Math.min(r0.bottom, clipBox.bottom), height: r0.height } : r0;
      if (r.right - r.left < 3 || r.bottom - r.top < 3) continue;
      const pad = r.height * 0.22;
      lines.push({ el, r: { l: r.left, t: r.top + pad + window.scrollY, rt: r.right, b: r.bottom - pad + window.scrollY } });
      if (r.right > W + 2 && !scrollsX(el)) add(out.defects, 'text-off-screen', `text runs ${Math.round(r.right - W)}px past the screen edge`, el);
    }
  }
  const controls = [...document.body.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=tab]')]
    .filter((el) => isVis(el) && getComputedStyle(el).display !== 'inline')
    .map((el) => { const r = el.getBoundingClientRect(); return { el, r: { l: r.left, t: r.top + window.scrollY, rt: r.right, b: r.bottom + window.scrollY } }; });
  const inter = (a, b) => Math.max(0, Math.min(a.rt, b.rt) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
  const related = (a, b) => a === b || a.contains(b) || b.contains(a);
  const layered = (el) => { for (let p = el; p && p !== document.body; p = p.parentElement) { const pos = getComputedStyle(p).position; if (pos === 'fixed' || pos === 'sticky') return true; } return false; };
  const seen = new Set();
  const report = (a, b, what) => {
    const key = `${describe(a)}|${describe(b)}`;
    if (seen.has(key) || seen.size > 12) return;
    seen.add(key);
    add(out.defects, 'overlap', `${what} overlaps ${describe(b)}`, a);
  };
  // Sort by top for a sweep instead of n^2 over the whole page.
  const items = [...lines.map((x) => ({ ...x, kind: 'text' })), ...controls.map((x) => ({ ...x, kind: 'control' }))].sort((a, b) => a.r.t - b.r.t);
  for (let i = 0; i < items.length; i += 1) {
    const a = items[i];
    if (layered(a.el)) continue;
    for (let j = i + 1; j < items.length && items[j].r.t < a.r.b; j += 1) {
      const b = items[j];
      if (a.kind === 'control' && b.kind === 'control') continue;
      if (related(a.el, b.el) || layered(b.el)) continue;
      // A control wrapping a text line is not an overlap; nor are two lines of one control.
      const ac = a.el.closest('a,button,label,summary'); const bc = b.el.closest('a,button,label,summary');
      if (ac && bc && ac === bc) continue;
      if ((a.kind === 'control' && a.el.contains(b.el)) || (b.kind === 'control' && b.el.contains(a.el))) continue;
      const area = inter(a.r, b.r);
      const minArea = Math.min((a.r.rt - a.r.l) * (a.r.b - a.r.t), (b.r.rt - b.r.l) * (b.r.b - b.r.t));
      if (area > 16 && area > 0.15 * minArea) report(a.el, b.el, a.kind === 'control' ? 'control' : 'text');
    }
  }

  // 5. Text smaller than 12px.
  const small = new Map();
  for (const { el } of lines) {
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px < 12 && !small.has(el)) small.set(el, px);
  }
  // A short capitalised label (a kicker, a table head, a crumb) at 10px is a house style to judge, not a defect; running text is.
  const isLabel = (el) => { const t = (el.textContent || '').trim(); return t.length <= 30 && /[A-Za-z]/.test(t) && (getComputedStyle(el).textTransform === 'uppercase' || t === t.toUpperCase()); };
  const tiny = [...small.entries()].filter(([el, px]) => px < 9.5 || (px < 10.95 && !isLabel(el)));
  const labels = [...small.entries()].filter(([el, px]) => px >= 9.5 && px < 10.95 && isLabel(el));
  const eleven = [...small.entries()].filter(([, px]) => px >= 10.95);
  if (tiny.length) {
    const sizes = [...new Set(tiny.map(([, v]) => Math.round(v * 10) / 10))].sort((a, b) => a - b);
    add(out.defects, 'small-text', `${tiny.length} text element(s) at ${sizes.join(', ')}px; body text needs 12px or more`, tiny[0][0]);
  }
  if (eleven.length) add(out.notes, 'small-text', `${eleven.length} text element(s) at 11px`, eleven[0][0]);
  if (labels.length) add(out.notes, 'small-label', `${labels.length} capitalised label(s) at 10px`, labels[0][0]);

  // 6. Tap targets under 24px with a neighbour closer than 24px (WCAG 2.5.8). Links inside running text are exempt.
  const allTargets = [...document.body.querySelectorAll('a[href],button,input,select,textarea,[role=button],[role=link],[role=tab]')]
    .filter((el) => isVis(el))
    .map((el) => { const r = el.getBoundingClientRect(); return { el, r: { l: r.left, t: r.top + window.scrollY, rt: r.right, b: r.bottom + window.scrollY } }; });
  const targets = allTargets.filter(({ el }) => {
    if (el.tagName === 'A') {
      const block = el.closest('p,li,td,dd,blockquote,figcaption');
      if (block && block.textContent.trim().length > el.textContent.trim().length + 8) return false;
    }
    return true;
  });
  const smallTargets = [];
  for (const t of targets) {
    const w = t.r.rt - t.r.l; const h = t.r.b - t.r.t;
    if (w >= 24 && h >= 24) continue;
    const cx = (t.r.l + t.r.rt) / 2; const cy = (t.r.t + t.r.b) / 2;
    const crowded = targets.some((o) => o !== t && !related(o.el, t.el) && Math.hypot((o.r.l + o.r.rt) / 2 - cx, (o.r.t + o.r.b) / 2 - cy) < 24);
    if (crowded) smallTargets.push(t.el);
  }
  if (smallTargets.length) add(out.defects, 'small-target', `${smallTargets.length} tap target(s) under 24px with a neighbour too close`, smallTargets[0]);

  // 7. Broken images.
  for (const img of document.images) {
    if (img.complete && img.naturalWidth === 0 && img.getAttribute('src') && isVis(img) && img.loading !== 'lazy') add(out.defects, 'broken-image', img.currentSrc || img.src, img);
  }

  return out;
}
