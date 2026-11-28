export function signature(d, r) {
  const scope = `${r?.path ?? ''}|${r?.type ?? ''}|${r?.view ?? ''}`;
  return d.kind === 'contrast'
    ? `${scope}|contrast|${d.pair}`
    : `${scope}|${d.kind}|${(d.where || '').replace(/"[^"]*"/, '')}|${d.kind.startsWith('a11y') || d.kind === 'small-text' || d.kind === 'small-target' ? '' : d.detail.replace(/\d+/g, '#')}`;
}
