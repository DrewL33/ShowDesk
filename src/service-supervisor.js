'use strict';

const { spawn } = require('node:child_process');

const [nodePath, serverPath] = process.argv.slice(2);
if (!nodePath || !serverPath) {
  console.error('ShowDesk service supervisor requires the Node runtime and service entry point.');
  process.exit(2);
}

const service = spawn(nodePath, [serverPath], {
  cwd: require('node:path').dirname(require('node:path').dirname(serverPath)),
  env: { ...process.env, SHOWDESK_NO_OPEN: '1' },
  stdio: ['ignore', 'inherit', 'inherit']
});

let shuttingDown = false;
let forceKillTimer = null;
function stopService() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (service.exitCode !== null || service.signalCode !== null) return;
  service.kill('SIGTERM');
  forceKillTimer = setTimeout(() => {
    if (service.exitCode === null && service.signalCode === null) service.kill('SIGKILL');
  }, 2000);
}

process.stdin.on('end', stopService);
process.stdin.resume();
service.once('error', error => {
  console.error('[ShowDesk supervisor] Unable to launch ATEM service:', error.message || error);
  process.exitCode = 1;
});
service.once('exit', (code, signal) => {
  if (forceKillTimer) clearTimeout(forceKillTimer);
  if (!shuttingDown) process.exit(code === 0 ? 0 : 1);
  process.exit(0);
});
