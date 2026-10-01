// Renames the portable build's output (dist-portable/index.html, produced by
// vite-plugin-singlefile) to a self-explanatory filename, so a file grabbed off a GitHub
// Release or downloaded standalone doesn't just say "index.html". Plain Node fs so it works
// the same on Windows/macOS/Linux (no shell `mv`).
import { renameSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const appDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const from = path.join(appDir, 'dist-portable', 'index.html');
const to = path.join(appDir, 'dist-portable', 'nanocore-editor-portable.html');

if (!existsSync(from)) {
  console.error(`[rename-portable-output] expected build output not found: ${from}`);
  process.exit(1);
}

renameSync(from, to);
console.log(`[rename-portable-output] ${path.relative(appDir, from)} -> ${path.relative(appDir, to)}`);
