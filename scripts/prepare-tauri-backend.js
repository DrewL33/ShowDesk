'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'dist');
const target = path.join(root, 'src-tauri', 'resources', 'backend');

if (!fs.existsSync(source)) {
  throw new Error('dist runtime is missing. Run npm run bundle before preparing the Tauri backend.');
}

fs.rmSync(target, { recursive: true, force: true });
fs.mkdirSync(target, { recursive: true });
fs.cpSync(source, target, { recursive: true, dereference: true });

const runtimeDir = path.join(target, 'runtime');
fs.mkdirSync(runtimeDir, { recursive: true });
const nodeName = process.platform === 'win32' ? 'node.exe' : 'node';
const nodeTarget = path.join(runtimeDir, nodeName);
fs.copyFileSync(process.execPath, nodeTarget);
if (process.platform !== 'win32') fs.chmodSync(nodeTarget, 0o755);

// setup-node can provide a universal macOS executable. Keep only the slice
// matching this build so every app does not ship both Node architectures.
if (process.platform === 'darwin') {
  const thinTarget = `${nodeTarget}.thin`;
  execFileSync('lipo', ['-thin', process.arch, nodeTarget, '-output', thinTarget]);
  fs.renameSync(thinTarget, nodeTarget);
  fs.chmodSync(nodeTarget, 0o755);
}

console.log(`Prepared native ShowDesk backend at ${target}`);
