// Check our pages, but do not fetch a third-party service after our own redirect.
// The handoff is valid only if our server actually returns a safe Location.
export async function checkLink(root, path, get) {
  let url = new URL(path, root);
  for (let hop = 0; hop < 5; hop += 1) {
    const result = await get(url.href, {}, 'manual');
    if (result.status < 300 || result.status >= 400 || result.status === 0) return result;
    let next;
    try { next = new URL(result.location, url); } catch { return { status: 0, error: 'invalid redirect location' }; }
    if (!result.location || next.protocol !== 'https:' || next.username || next.password) return { status: 0, error: 'invalid redirect location' };
    if (next.origin !== new URL(root).origin) return result;
    url = next;
  }
  return { status: 0, error: 'redirect loop' };
}
