const fs = require('node:fs');
const path = require('node:path');
fs.mkdirSync('dist', { recursive: true });
const exe = 'sea-prep.blob';
fs.writeFileSync('dist/sea-config.json', JSON.stringify({
  main: path.resolve('dist/server.cjs'),
  mainFormat: 'commonjs',
  output: path.resolve('dist', exe),
  disableExperimentalSEAWarning: true,
  useCodeCache: false,
  assets: {
    'index.html': path.resolve('public/index.html'),
    'transport.js': path.resolve('public/transport.js'),
    'freetype2.node': path.resolve('dist/prebuilds', `freetype2-${process.platform}-${process.arch}`, 'node-napi-v7.node')
  }
}, null, 2));
