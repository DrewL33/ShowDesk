const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/sea-config.json', JSON.stringify({
  main: path.resolve('dist/server.cjs'),
  mainFormat: 'commonjs',
  output: path.resolve('dist', 'sea-prep.blob'),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: {
    'index.html': path.resolve('public/index.html'),
    'transport.js': path.resolve('public/transport.js')
  }
}, null, 2));
