'use strict';

const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
let WebSocket;
try { ({ WebSocket } = require('ws')); }
catch { console.log('Mobile Viewer HTTP/WebSocket integration check skipped (runtime dependencies are not installed)'); process.exit(0); }

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}
function request(url) {
  return new Promise((resolve, reject) => {
    http.get(url, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    }).once('error', reject);
  });
}
function waitForViewer(port, child) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (child.exitCode !== null) return reject(new Error(`ShowDesk server exited early (${child.exitCode})`));
      http.get(`http://127.0.0.1:${port}/health`, response => {
        response.resume();
        if (response.statusCode === 200) return resolve();
        retry();
      }).once('error', retry);
      function retry() {
        if (Date.now() - started > 8000) return reject(new Error('ShowDesk Viewer server did not start in time'));
        setTimeout(check, 100);
      }
    };
    check();
  });
}
function firstMessage(ws) {
  return new Promise((resolve, reject) => {
    ws.once('message', raw => resolve(JSON.parse(raw.toString())));
    ws.once('error', reject);
  });
}
function nextReply(ws, id) {
  return new Promise((resolve, reject) => {
    const onMessage = raw => { let message; try { message = JSON.parse(raw.toString()); } catch { return; } if (message.replyTo !== id) return; ws.off('message', onMessage); resolve(message); };
    ws.on('message', onMessage); ws.once('error', reject);
  });
}
function nextMessageOfType(ws, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.off('message', onMessage); reject(new Error(`Timed out waiting for ${type}`)); }, 2000);
    const onMessage = raw => {
      let message; try { message = JSON.parse(raw.toString()); } catch { return; }
      if (message.type !== type) return;
      clearTimeout(timer); ws.off('message', onMessage); resolve(message);
    };
    ws.on('message', onMessage);
    ws.once('error', reject);
  });
}

(async () => {
  const appPort = await freePort();
  let viewerPort = await freePort();
  while (viewerPort === appPort) viewerPort = await freePort();
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'src/server.js')], {
    cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, SHOWDESK_NO_OPEN: '1', SHOWDESK_PORT: String(appPort), SHOWDESK_VIEWER_PORT: String(viewerPort) },
    stdio: 'ignore'
  });
  try {
    await waitForViewer(viewerPort, child);
    const page = await request(`http://127.0.0.1:${viewerPort}/`);
    assert.equal(page.status, 200, 'Viewer service root must load the phone page');
    assert.match(page.headers['content-type'], /text\/html/);
    assert.match(page.headers['content-security-policy'], /default-src 'self'/);
    assert.match(page.body, /ShowDesk Mobile Viewer/);
    const script = await request(`http://127.0.0.1:${viewerPort}/mobile-viewer.js`);
    assert.equal(script.status, 200, 'Mobile Viewer script must load from the host');
    const style = await request(`http://127.0.0.1:${viewerPort}/mobile-viewer.css`);
    assert.equal(style.status, 200, 'Mobile Viewer stylesheet must load from the host');

    const control = new WebSocket(`ws://127.0.0.1:${appPort}/ws`);
    await new Promise((resolve, reject) => { control.once('open', resolve); control.once('error', reject); });
    const published = nextReply(control, 'reference-test');
    control.send(JSON.stringify({ id: 'reference-test', type: 'referenceAttention', data: { attached: true, name: 'Show file', categories: [{ category: 'routing', label: 'AUX / Output Routing', status: 'mismatch', summary: '1 mismatch', details: [{ name: 'AUX 1', kind: 'mismatch', message: 'Expected Camera · Actual Laptop' }] }] } }));
    const publishReply = await published;
    assert.equal(publishReply.replyTo, 'reference-test', 'Host reference attention publish must receive an acknowledgement');

    const ws = new WebSocket(`ws://127.0.0.1:${viewerPort}/viewer`);
    const greetingPromise = firstMessage(ws);
    const attentionPromise = nextMessageOfType(ws, 'referenceAttention');
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const greeting = await greetingPromise;
    assert.equal(greeting.type, 'connection');
    assert.equal(greeting.status, 'waiting', 'Viewer socket must report that the Host is waiting when no ATEM is connected');
    const attention = await attentionPromise;
    assert.equal(attention.data.name, 'Show file', 'Viewer must receive the latest Host reference summary');
    assert.equal(attention.data.categories[0].details[0].message, 'Expected Camera · Actual Laptop', 'Reference attention details must be relayed');
    const unexpectedReply = new Promise(resolve => {
      ws.once('message', () => resolve(true));
      setTimeout(() => resolve(false), 100);
    });
    ws.send(JSON.stringify({ id: 'mobile-read-only-check', type: 'disconnect' }));
    assert.equal(await unexpectedReply, false, 'Read-only Viewer socket must ignore command messages');
    ws.close();
    control.close();
    console.log('Mobile Viewer HTTP and read-only WebSocket integration checks passed');
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => {
      if (child.exitCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 1500).unref();
    });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
