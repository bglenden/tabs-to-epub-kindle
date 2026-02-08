import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const distDir = path.join(repoRoot, 'dist');
const iconsDir = path.join(repoRoot, 'src', 'extension', 'icons');

const staticFiles = [
  {
    src: path.join(repoRoot, 'manifest.json'),
    dest: path.join(distDir, 'manifest.json'),
    optional: false
  },
  {
    src: path.join(repoRoot, 'src', 'extension', 'vendor', 'readability.js'),
    dest: path.join(distDir, 'extension', 'vendor', 'readability.js'),
    optional: false
  },
  {
    src: path.join(repoRoot, 'src', 'extension', 'vendor', 'Readability.LICENSE.md'),
    dest: path.join(distDir, 'extension', 'vendor', 'Readability.LICENSE.md'),
    optional: true
  },
  {
    src: path.join(repoRoot, 'src', 'extension', 'test.html'),
    dest: path.join(distDir, 'extension', 'test.html'),
    optional: false
  },
  {
    src: path.join(repoRoot, 'src', 'extension', 'popup.html'),
    dest: path.join(distDir, 'extension', 'popup.html'),
    optional: false
  },
  ...['icon-16.png', 'icon-48.png', 'icon-128.png'].map((name) => ({
    src: path.join(iconsDir, name),
    dest: path.join(distDir, 'extension', 'icons', name),
    optional: false
  }))
];

async function copyFile({ src, dest, optional }) {
  try {
    await fsPromises.mkdir(path.dirname(dest), { recursive: true });
    await fsPromises.copyFile(src, dest);
  } catch (err) {
    if (optional && (err && typeof err === 'object') && 'code' in err && err.code === 'ENOENT') {
      return;
    }
    console.error(`Failed to copy ${src} -> ${dest}`);
    throw err;
  }
}

async function copyStatic() {
  await fsPromises.mkdir(distDir, { recursive: true });
  for (const file of staticFiles) {
    await copyFile(file);
  }
}

function startTypeScriptWatch() {
  const tscBin = path.join(
    repoRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
  );
  const child = spawn(tscBin, ['-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], {
    stdio: 'inherit'
  });
  child.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`tsc watch exited with code ${code}`);
    }
  });
}

function watchStatic() {
  const dirMap = new Map();
  for (const file of staticFiles) {
    const dir = path.dirname(file.src);
    const name = path.basename(file.src);
    if (!dirMap.has(dir)) {
      dirMap.set(dir, new Map());
    }
    dirMap.get(dir).set(name, file);
  }

  for (const [dir, fileMap] of dirMap.entries()) {
    fs.watch(dir, (event, filename) => {
      if (!filename) return;
      const file = fileMap.get(filename);
      if (!file) return;
      copyFile(file).catch((err) => {
        console.error(err);
      });
    });
  }
}

async function main() {
  await copyStatic();
  startTypeScriptWatch();
  watchStatic();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
