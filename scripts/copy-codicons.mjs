import { mkdirSync, copyFileSync, existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@vscode', 'codicons', 'dist');
const dest = join(root, 'webview-ui', 'dist', 'codicons');

mkdirSync(dest, { recursive: true });
for (const file of ['codicon.css', 'codicon.ttf']) {
  const from = join(src, file);
  if (existsSync(from)) copyFileSync(from, join(dest, file));
}
console.log(`codicons copied to ${dest}`);
