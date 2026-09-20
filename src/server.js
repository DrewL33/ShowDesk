const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { exec } = require('node:child_process');
const { WebSocketServer } = require('ws');
const { Atem } = require('atem-connection');

const HOST = '127.0.0.1';
const PORT = Number(process.env.SHOWDESK_PORT || 47821);
let atem = null;
let currentIp = null;
let lastState = null;
const clients = new Set();

function asset(name) {
  try {
    const sea = require('node:sea');
    if (sea.isSea()) return Buffer.from(sea.getAsset(name));
  } catch {}
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
    id: Number(id), name: x.longName || x.shortName || `INPUT ${id}`,
    shortName: x.shortName || ''
  }));
  const me0 = state.video?.mixEffects?.[0];
  const auxRaw = state.video?.auxilliaries || [];
  const aux = auxRaw.map((source, i) => ({ name: `OUTPUT ${i + 1}`, route: inputName(state, source), sourceId: source }));
  return {
    pgm: inputName(state, me0?.programInput),
    pvw: inputName(state, me0?.previewInput),
    inputs,
    aux
  };
}

function discovery(state) {
  const normalized = normalizeState(state) || { inputs: [], aux: [] };
  return {
    name: state?.info?.productIdentifier || 'ATEM Switcher',
    ip: currentIp,
    inputs: normalized.inputs.length,
    outputs: normalized.aux.length,
    mes: state?.info?.mixEffects || state?.video?.mixEffects?.length || 1,
    keys: state?.info?.mixEffects ? state.info.mixEffects * 4 : 4,
    inputList: normalized.inputs,
    ...normalized
  };
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  for (const ws of clients) if (ws.readyState === 1) ws.send(payload);
}

async function disconnectAtem() {
  if (!atem) return;
  try { await atem.disconnect(); } catch {}
  atem = null; currentIp = null; lastState = null;
}

async function connectAtem(ip) {
  await disconnectAtem();
  const instance = new Atem();
  atem = instance;
  currentIp = ip;

  instance.on('stateChanged', (state) => {
    lastState = state;
    const normalized = normalizeState(state);
    if (normalized) broadcast({ type: 'state', data: normalized });
  });
  instance.on('disconnected', () => broadcast({ type: 'connection', status: 'disconnected' }));
  instance.on('error', (error) => console.error('[ATEM]', error));

  await instance.connect(ip);
  const deadline = Date.now() + 8000;
  while (!instance.state && Date.now() < deadline) await new Promise(r => setTimeout(r, 100));
  if (!instance.state) throw new Error(`ATEM at ${ip} connected but did not provide state.`);
  lastState = instance.state;
  return discovery(instance.state);
}

const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host}`).pathname;
  const item = ASSETS[pathname];
  if (!item) { res.writeHead(404); return res.end('Not found'); }
  try {
    res.writeHead(200, { 'Content-Type': item[1], 'Cache-Control': 'no-store' });
    res.end(asset(item[0]));
  } catch (error) {
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
