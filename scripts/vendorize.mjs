import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

const srcReadability = path.join(repoRoot, 'node_modules', '@mozilla', 'readability', 'Readability.js');
const srcLicense = path.join(repoRoot, 'node_modules', '@mozilla', 'readability', 'LICENSE.md');

const destDir = path.join(repoRoot, 'src', 'extension', 'vendor');
const destReadability = path.join(destDir, 'readability.js');
const destLicense = path.join(destDir, 'Readability.LICENSE.md');

async function main() {
  await fs.mkdir(destDir, { recursive: true });
  const readability = await fs.readFile(srcReadability, 'utf8');
  await fs.writeFile(destReadability, readability, 'utf8');
  const license = await fs.readFile(srcLicense, 'utf8');
  await fs.writeFile(destLicense, license, 'utf8');
  console.log('Vendored Readability.js into src/extension/vendor/readability.js');
}

main().catch((err) => {
  console.error('Vendorize failed:', err.message);
  process.exit(1);
});
