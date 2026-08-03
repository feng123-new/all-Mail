import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assetsDirectory = path.join(webRoot, 'dist', 'assets');

const budgets = {
  largestJavaScript: 720 * 1024,
  totalJavaScript: 3.5 * 1024 * 1024,
  totalCss: 256 * 1024,
};

const formatBytes = (bytes) => `${(bytes / 1024).toFixed(2)} KiB`;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(absolutePath));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const metadata = await stat(absolutePath);
    files.push({
      name: path.relative(assetsDirectory, absolutePath),
      bytes: metadata.size,
    });
  }

  return files;
}

const files = await collectFiles(assetsDirectory);
const javaScript = files.filter((file) => /\.(?:js|mjs)$/i.test(file.name));
const css = files.filter((file) => /\.css$/i.test(file.name));

if (javaScript.length === 0) {
  throw new Error('frontend build budget found no JavaScript assets; run npm run build first');
}

const totalJavaScript = javaScript.reduce((sum, file) => sum + file.bytes, 0);
const totalCss = css.reduce((sum, file) => sum + file.bytes, 0);
const largestJavaScript = [...javaScript].sort((left, right) => right.bytes - left.bytes)[0];

const failures = [];
if (largestJavaScript.bytes > budgets.largestJavaScript) {
  failures.push(
    `largest JavaScript asset ${largestJavaScript.name} is ${formatBytes(largestJavaScript.bytes)}; budget is ${formatBytes(budgets.largestJavaScript)}`,
  );
}
if (totalJavaScript > budgets.totalJavaScript) {
  failures.push(
    `total JavaScript is ${formatBytes(totalJavaScript)}; budget is ${formatBytes(budgets.totalJavaScript)}`,
  );
}
if (totalCss > budgets.totalCss) {
  failures.push(
    `total CSS is ${formatBytes(totalCss)}; budget is ${formatBytes(budgets.totalCss)}`,
  );
}

console.log(`frontend bundle: ${javaScript.length} JavaScript assets, ${formatBytes(totalJavaScript)} total`);
console.log(`frontend bundle: largest JavaScript asset ${largestJavaScript.name}, ${formatBytes(largestJavaScript.bytes)}`);
console.log(`frontend bundle: ${css.length} CSS assets, ${formatBytes(totalCss)} total`);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`budget failure: ${failure}`);
  }
  process.exitCode = 1;
}
