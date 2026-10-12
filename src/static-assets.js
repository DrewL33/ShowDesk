'use strict';

const path = require('node:path');
const fs = require('node:fs');

function asset(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', name));
}

const ASSETS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/transport.js': ['transport.js', 'text/javascript; charset=utf-8'],
  '/signal-paths.js': ['signal-paths.js', 'text/javascript; charset=utf-8'],
  '/reference-parser.js': ['reference-parser.js', 'text/javascript; charset=utf-8'],
  '/reference-comparison.js': ['reference-comparison.js', 'text/javascript; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
  '/mobile': ['mobile-viewer.html', 'text/html; charset=utf-8'],
  '/mobile/': ['mobile-viewer.html', 'text/html; charset=utf-8'],
  '/mobile-viewer.html': ['mobile-viewer.html', 'text/html; charset=utf-8'],
  '/mobile-viewer.js': ['mobile-viewer.js', 'text/javascript; charset=utf-8'],
  '/mobile-viewer.css': ['mobile-viewer.css', 'text/css; charset=utf-8']
};

module.exports = { asset, ASSETS };
