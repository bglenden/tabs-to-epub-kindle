import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');

async function runTsc() {
  const tscBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  );
  try {
    execFileSync(tscBin, ['-p', 'tsconfig.json'], { stdio: 'inherit' });
  } catch (err) {
    console.error('TypeScript build failed.');
    throw err;
  }
}

async function copyFile(src, dest) {
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function build() {
  await fs.rm(distDir, { recursive: true, force: true });
  await runTsc();

  await copyFile(path.join(repoRoot, 'manifest.json'), path.join(distDir, 'manifest.json'));
  await copyFile(
    path.join(repoRoot, 'src', 'extension', 'vendor', 'readability.js'),
    path.join(distDir, 'extension', 'vendor', 'readability.js')
  );

  try {
    await copyFile(
      path.join(repoRoot, 'src', 'extension', 'vendor', 'Readability.LICENSE.md'),
      path.join(distDir, 'extension', 'vendor', 'Readability.LICENSE.md')
    );
  } catch {
    // Optional license file.
  }

  await copyFile(
    path.join(repoRoot, 'src', 'extension', 'test.html'),
    path.join(distDir, 'extension', 'test.html')
  );
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
