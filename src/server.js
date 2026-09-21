const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { exec } = require('node:child_process');
const { WebSocketServer } = require('ws');
let Atem;

function loadAtem() {
  if (Atem) return Atem;
  let module;
  try {
    module = require('atem-connection');
  } catch (error) {
    throw new Error(`Unable to load packaged ATEM runtime: ${error.message || error}`);
  }
  const AtemClass = module.Atem || module.default?.Atem || module.default;
  if (typeof AtemClass !== 'function') {
    throw new Error('ATEM connection module loaded, but its Atem constructor was not available.');
  }
  Atem = AtemClass;
  return Atem;
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.SHOWDESK_PORT || 47821);
const CONNECT_TIMEOUT_MS = 8000;
const STATE_TIMEOUT_MS = 8000;
let atem = null;
let currentIp = null;
let lastState = null;
let hasConnected = false;
const clients = new Set();

function asset(name) {
  return fs.readFileSync(path.join(__dirname, '..', 'public', name));
}
const ASSETS = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/transport.js': ['transport.js', 'text/javascript; charset=utf-8']
};

function inputName(state, id) {
  const input = state?.inputs?.[id];
  return input?.longName || input?.shortName || input?.externalPortType || `INPUT ${id}`;
}
function normalizeState(state) {
  if (!state) return null;
  const inputs = Object.entries(state.inputs || {}).map(([id, x]) => ({
    id: Number(id), name: x.longName || x.shortName || `INPUT ${id}`, shortName: x.shortName || ''
  }));
  const me0 = state.video?.mixEffects?.[0];
  const auxRaw = state.video?.auxilliaries || [];
  const aux = auxRaw.map((source, i) => ({ name: `OUTPUT ${i + 1}`, route: inputName(state, source), sourceId: source }));
  return { pgm: inputName(state, me0?.programInput), pvw: inputName(state, me0?.previewInput), inputs, aux };
}
function discovery(state) {
  const normalized = normalizeState(state) || { inputs: [], aux: [] };
  return {
    name: state?.info?.productIdentifier || 'ATEM Switcher', ip: currentIp,
    inputs: normalized.inputs.length, outputs: normalized.aux.length,
    mes: state?.info?.mixEffects || state?.video?.mixEffects?.length || 1,
    keys: state?.info?.mixEffects ? state.info.mixEffects * 4 : 4,
    inputList: normalized.inputs, ...normalized
  };
}
function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of clients) if (ws.readyState === 1) ws.send(payload);
}
function timeout(promise, ms, message) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(message)), ms); })
  ]).finally(() => clearTimeout(timer));
}
async function disconnectInstance(instance) {
  if (!instance) return;
  try { await Promise.race([instance.disconnect(), new Promise(resolve => setTimeout(resolve, 1000))]); } catch {}
}
async function disconnectAtem() {
  const instance = atem;
  atem = null; currentIp = null; lastState = null; hasConnected = false;
  await disconnectInstance(instance);
}
async function connectAtem(ip) {
  await disconnectAtem();
  const AtemClass = loadAtem();
  const instance = new AtemClass();
  atem = instance; currentIp = ip; hasConnected = false;

  instance.on('stateChanged', (state) => {
    if (atem !== instance) return;
    lastState = state;
    const normalized = normalizeState(state);
    if (normalized) broadcast({ type: 'state', data: normalized });
  });
  instance.on('disconnected', () => {
    if (atem !== instance) return;
    const wasConnected = hasConnected;
    atem = null; currentIp = null; lastState = null; hasConnected = false;
    if (wasConnected) broadcast({ type: 'connection', status: 'disconnected', reason: 'ATEM connection lost' });
  });
  instance.on('error', (error) => console.error('[ATEM]', error));

  try {
    await timeout(instance.connect(ip), CONNECT_TIMEOUT_MS, `Connection to ATEM at ${ip} timed out after ${CONNECT_TIMEOUT_MS / 1000} seconds.`);
    const deadline = Date.now() + STATE_TIMEOUT_MS;
    while (!instance.state && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
    if (!instance.state) throw new Error(`ATEM at ${ip} responded, but switcher state was not received within ${STATE_TIMEOUT_MS / 1000} seconds.`);
    if (atem !== instance) throw new Error('ATEM connection attempt was cancelled.');
    hasConnected = true;
    lastState = instance.state;
    return discovery(instance.state);
  } catch (error) {
    if (atem === instance) {
      atem = null; currentIp = null; lastState = null; hasConnected = false;
    }
    await disconnectInstance(instance);
    throw error;
  }
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const item = ASSETS[pathname];
  if (!item) { res.writeHead(404); return res.end('Not found'); }
  try {
    res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store' });
    res.end(asset(item[0]));
  } catch {
    res.writeHead(500); res.end('ShowDesk asset error');
  }
});
const wss = new WebSocketServer({ server, path: '/ws' });
wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', async raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const reply = (ok, data, error) => ws.send(JSON.stringify({ replyTo: msg.id, ok, data, error }));
    try {
      if (msg.type === 'connect') return reply(true, await connectAtem(msg.ip));
      if (msg.type === 'disconnect') { await disconnectAtem(); return reply(true, { disconnected: true }); }
      reply(false, null, 'Unknown request');
    } catch (error) {
      console.error('[ShowDesk]', error);
      reply(false, null, error.message || String(error));
    }
  });
});
server.listen(PORT, HOST, () => {
  const url = `http://${HOST}:${PORT}`;
  console.log(`ShowDesk running at ${url}`);
  if (process.env.SHOWDESK_NO_OPEN !== '1') {
    const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
process.on('SIGINT', async () => { await disconnectAtem(); process.exit(0); });
process.on('SIGTERM', async () => { await disconnectAtem(); process.exit(0); });
