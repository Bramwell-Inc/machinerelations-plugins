// The directory package is documents and data. The page checker lives beside
// the Action, outside this tree. One rule, used by the package validator,
// the regression test and the fresh-install check.
import { readdirSync } from 'node:fs';
import path from 'node:path';

export const PACKAGE_ROOT = 'plugins/machine-relations-index';

const EXTENSIONS = new Set(['.md', '.txt', '.json', '.yaml', '.yml', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico']);
const BARE_NAMES = new Set(['license', 'readme', '.gitignore', 'icon']);

export function packageFileAllowed(relativePath) {
  const base = path.basename(String(relativePath));
  if (BARE_NAMES.has(base.toLowerCase())) return true;
  return EXTENSIONS.has(path.extname(base).toLowerCase());
}

export function listPackageFiles(root = PACKAGE_ROOT) {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join('/'));
    }
  };
  walk(root);
  return out.sort();
}

export function rejectedPackageFiles(files) {
  return files.filter((file) => !packageFileAllowed(file));
}
