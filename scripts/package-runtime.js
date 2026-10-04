const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const dist = path.resolve('dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

fs.cpSync('src', path.join(dist, 'src'), { recursive: true });
fs.cpSync('public', path.join(dist, 'public'), { recursive: true });

const rootPackage = require('../package.json');
const runtimeDependencies = {};
for (const name of ['atem-connection', 'ws']) {
  const version = rootPackage.dependencies?.[name];
  if (!version) throw new Error(`Missing required ShowDesk runtime dependency: ${name}`);
  runtimeDependencies[name] = version;
}

const runtimePackage = {
  name: 'showdesk-runtime',
  version: rootPackage.version,
  private: true,
  main: 'src/server.js',
  dependencies: runtimeDependencies
};
fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
execFileSync(npm, ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
  cwd: dist,
  stdio: 'inherit'
});

for (const name of Object.keys(runtimeDependencies)) {
  const entry = path.join(dist, 'node_modules', name);
  if (!fs.existsSync(entry)) throw new Error(`Runtime dependency was not staged: ${name}`);
}
