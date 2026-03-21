import { cp, access, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const sourceDir = path.join(repoRoot, 'web', 'dist');
const targetDir = path.join(repoRoot, 'public');

try {
  await access(sourceDir);
} catch {
  console.error(`web dist directory not found: ${sourceDir}`);
  console.error('Run `npm --prefix web run build` before preparing static assets.');
  process.exit(1);
}

await rm(targetDir, { recursive: true, force: true });
await cp(sourceDir, targetDir, { recursive: true });

console.log(`Copied ${sourceDir} -> ${targetDir}`);
