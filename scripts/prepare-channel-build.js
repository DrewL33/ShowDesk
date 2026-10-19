'use strict';

const fs = require('node:fs');
const path = require('node:path');

const channel = process.env.SHOWDESK_CHANNEL || 'stable';
const config = channel === 'beta'
  ? { channel, servicePort: 47831, viewerPort: 47832, title: 'ShowDesk BETA' }
  : { channel: 'stable', servicePort: 47821, viewerPort: 47822, title: 'ShowDesk' };
const output = `window.SHOWDESK_CONFIG = ${JSON.stringify(config)};\ndocument.title = window.SHOWDESK_CONFIG.title;\n`;
fs.writeFileSync(path.join(__dirname, '..', 'public', 'runtime-config.js'), output);
console.log(`Prepared ${config.channel} frontend build configuration (service ${config.servicePort}, viewer ${config.viewerPort}).`);
