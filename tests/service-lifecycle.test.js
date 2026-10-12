'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function viewerReady(port) {
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/health', timeout: 500 }, response => {
      response.resume();
      resolve(response.statusCode === 200);
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(false));
  });
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(message);
}

async function waitForExit(exit, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      exit,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), timeoutMs); })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const hostPort = await freePort();
  let viewerPort = await freePort();
  while (viewerPort === hostPort) viewerPort = await freePort();
  const child = spawn(process.execPath, [
    path.join(__dirname, '../src/service-supervisor.js'),
    process.execPath,
    path.join(__dirname, '../src/server.js')
  ], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      SHOWDESK_NO_OPEN: '1',
      SHOWDESK_PARENT_GUARD: '1',
      SHOWDESK_PORT: String(hostPort),
      SHOWDESK_VIEWER_PORT: String(viewerPort),
      SHOWDESK_VIEWER_HOST: '127.0.0.1'
    },
    stdio: ['pipe', 'ignore', 'ignore']
  });

  try {
    await waitUntil(() => viewerReady(viewerPort), 3000, 'ShowDesk Viewer did not start for lifecycle test');
    child.stdin.end();
    const exit = new Promise((resolve, reject) => {
      child.once('exit', (code, signal) => resolve({ code, signal }));
      child.once('error', reject);
    });
    const result = await waitForExit(exit, 3000, 'Service did not exit after its parent pipe closed');
    assert.deepEqual(result, { code: 0, signal: null });
    await waitUntil(() => viewerReady(viewerPort).then(ready => !ready), 1500, 'ShowDesk Viewer port remained open after parent exit');
    console.log('service parent-exit lifecycle regression passed');
  } catch (error) {
    child.kill();
    throw error;
  }

  const stubborn = spawn(process.execPath, [
    path.join(__dirname, '../src/service-supervisor.js'),
    process.execPath,
    path.join(__dirname, 'fixtures/ignore-termination.js')
  ], { stdio: ['pipe', 'ignore', 'ignore'] });
  const stubbornExit = new Promise((resolve, reject) => {
    stubborn.once('exit', (code, signal) => resolve({ code, signal }));
    stubborn.once('error', reject);
  });
  stubborn.stdin.end();
  const stubbornResult = await waitForExit(stubbornExit, 4000, 'Supervisor did not force-stop an unresponsive service');
  assert.deepEqual(stubbornResult, { code: 0, signal: null });
  console.log('unresponsive service forced-shutdown regression passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
