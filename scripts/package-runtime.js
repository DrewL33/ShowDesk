const fs = require('node:fs');
const path = require('node:path');

const dist = path.resolve('dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

fs.cpSync('src', path.join(dist, 'src'), { recursive: true });
fs.cpSync('public', path.join(dist, 'public'), { recursive: true });
fs.cpSync('node_modules', path.join(dist, 'node_modules'), { recursive: true });

const runtimePackage = {
  name: 'showdesk-runtime',
  version: require('../package.json').version,
  private: true,
  main: 'src/server.js'
};
fs.writeFileSync(path.join(dist, 'package.json'), JSON.stringify(runtimePackage, null, 2) + '\n');
