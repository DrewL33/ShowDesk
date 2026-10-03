const http = require('node:http');
const { exec } = require('node:child_process');
const { WebSocket, WebSocketServer } = require('ws');
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
const VIEWER_HOST = process.env.SHOWDESK_VIEWER_HOST || '0.0.0.0';
const VIEWER_PORT = Number(process.env.SHOWDESK_VIEWER_PORT || 47822);
const CONNECT_TIMEOUT_MS = 8000;
const STATE_TIMEOUT_MS = 8000;
let atem = null;
let currentIp = null;
let lastState = null;
let hasConnected = false;
const clients = new Set();
const viewerClients = new Set();
let viewerUpstream = null;

function viewerSnapshot() {
  if (!hasConnected || !lastState) return null;
  const normalized = normalizeState(lastState);
  if (!normalized) return null;
  return { type: 'snapshot', data: { ...discovery(lastState), ...normalized } };
}
function broadcastViewers(message) {
  const payload = JSON.stringify(message);
  for (const ws of viewerClients) if (ws.readyState === 1) ws.send(payload);
}

const { asset, ASSETS } = require('./static-assets');

const { normalizeState } = require('./atem-state');
function discovery(state) {
  const normalized = normalizeState(state) || { inputs: [], aux: [], mixEffects: [], downstreamKeyers: [] };
  return {
    name: normalized.productIdentifier || 'ATEM Switcher', ip: currentIp,
    inputs: normalized.inputs.length, outputs: normalized.topology?.capabilityAuxBuses ?? normalized.aux.length,
    mes: normalized.mixEffects.length,
    keys: normalized.mixEffects.reduce((n, me) => n + me.upstreamKeyers.length, 0) + normalized.downstreamKeyers.length,
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
  const wasConnected = hasConnected;
  atem = null; currentIp = null; lastState = null; hasConnected = false;
  await disconnectInstance(instance);
  if (wasConnected) {
    broadcast({ type: 'connection', status: 'disconnected', reason: 'ATEM disconnected intentionally' });
    broadcastViewers({ type: 'connection', status: 'waiting', reason: 'Host is not connected to an ATEM' });
  }
}
async function disconnectViewerHost() {
  const ws = viewerUpstream;
  viewerUpstream = null;
  if (ws) { try { ws.close(); } catch {} }
  return { disconnected: true };
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
    if (normalized) {
      broadcast({ type: 'state', data: normalized });
      broadcastViewers({ type: 'state', data: normalized });
    }
  });
  instance.on('disconnected', () => {
    if (atem !== instance) return;
    const wasConnected = hasConnected;
    atem = null; currentIp = null; lastState = null; hasConnected = false;
    if (wasConnected) {
      const message = { type: 'connection', status: 'disconnected', reason: 'ATEM connection lost' };
      broadcast(message);
      broadcastViewers(message);
    }
  });
  instance.on('error', (error) => console.error('[ATEM]', error));

  // Some ATEM models/library versions can populate usable state before the
  // high-level "connected" event arrives. Discovery should wait for usable
  // topology/state, not one particular event ordering.
  let stateResolve;
  let stateReject;
  const usableState = new Promise((resolve, reject) => {
    stateResolve = resolve;
    stateReject = reject;
  });
  const hasUsableState = state => !!state && (
    Object.keys(state.inputs || {}).length > 0 ||
    (state.video?.mixEffects || []).filter(Boolean).length > 0 ||
    (state.video?.auxilliaries || []).length > 0 ||
    !!state.info?.productIdentifier
  );
  const onDiscoveryState = state => { if (hasUsableState(state)) stateResolve(state); };
  const onConnected = () => { if (hasUsableState(instance.state)) stateResolve(instance.state); };
  const onInitDisconnect = () => stateReject(new Error(`ATEM at ${ip} disconnected before discovery completed.`));
  instance.on('stateChanged', onDiscoveryState);
  instance.once('connected', onConnected);
  instance.once('disconnected', onInitDisconnect);

  try {
    await timeout(instance.connect(ip), CONNECT_TIMEOUT_MS, `Connection to ATEM at ${ip} timed out after ${CONNECT_TIMEOUT_MS / 1000} seconds.`);
    const discoveredState = hasUsableState(instance.state)
      ? instance.state
      : await timeout(usableState, STATE_TIMEOUT_MS, `ATEM at ${ip} responded, but usable switcher state was not received within ${STATE_TIMEOUT_MS / 1000} seconds.`);
    instance.removeListener('stateChanged', onDiscoveryState);
    instance.removeListener('disconnected', onInitDisconnect);
    if (!discoveredState) throw new Error(`ATEM at ${ip} initialized without switcher state.`);
    if (atem !== instance) throw new Error('ATEM connection attempt was cancelled.');
    hasConnected = true;
    lastState = discoveredState;
    const discovered = discovery(discoveredState);
    broadcastViewers({ type: 'snapshot', data: discovered });
    return discovered;
  } catch (error) {
    instance.removeListener('stateChanged', onDiscoveryState);
    instance.removeListener('disconnected', onInitDisconnect);
    if (atem === instance) {
      atem = null; currentIp = null; lastState = null; hasConnected = false;
    }
    await disconnectInstance(instance);
    throw error;
  }
}

async function connectViewerHost(host) {
  if (viewerUpstream) { try { viewerUpstream.close(); } catch {} viewerUpstream = null; }
  const target = String(host || '').trim().replace(/^wss?:\/\//, '').replace(/\/$/, '');
  if (!target) throw new Error('ShowDesk Host address is required.');
  const url = `ws://${target.includes(':') ? target : target + ':47822'}/viewer`;
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url); viewerUpstream = ws; let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch {} reject(new Error('ShowDesk Host did not respond in time.')); } }, 10000);
    ws.on('message', raw => {
      let msg; try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type === 'snapshot') { broadcast({ type: 'connection', status: 'viewer-connected', data: msg.data }); if (!settled) { settled = true; clearTimeout(timer); resolve({ status: 'connected', data: msg.data }); } return; }
      if (msg.type === 'state') { broadcast(msg); return; }
      if (msg.type === 'connection') { broadcast(msg); if (!settled && msg.status === 'waiting') { settled = true; clearTimeout(timer); resolve({ status: 'waiting', reason: msg.reason || 'Host is waiting for an ATEM.' }); } }
    });
    ws.on('error', error => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Unable to reach ShowDesk Host at ${target}: ${error.message || error}`)); } });
    ws.on('close', () => { if (viewerUpstream === ws) viewerUpstream = null; if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Unable to reach ShowDesk Host at ${target}.`)); } else broadcast({ type: 'connection', status: 'disconnected', reason: 'ShowDesk Host connection lost' }); });
  });
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
      if (msg.type === 'connectViewerHost') return reply(true, await connectViewerHost(msg.host));
      if (msg.type === 'disconnectViewerHost') return reply(true, await disconnectViewerHost());
      if (msg.type === 'disconnect') { await disconnectAtem(); return reply(true, { disconnected: true }); }
      reply(false, null, 'Unknown request');
    } catch (error) {
      console.error('[ShowDesk]', error);
      reply(false, null, error.message || String(error));
    }
  });
});
// Viewer service is intentionally separate from the local control service.
const viewerServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ service: 'ShowDesk Viewer', connected: hasConnected, model: lastState ? discovery(lastState).name : null }));
  }
  res.writeHead(404); res.end('Not found');
});
const viewerWss = new WebSocketServer({ server: viewerServer, path: '/viewer' });
viewerWss.on('connection', ws => {
  viewerClients.add(ws);
  const snapshot = viewerSnapshot();
  if (snapshot) ws.send(JSON.stringify(snapshot));
  else ws.send(JSON.stringify({ type: 'connection', status: 'waiting', reason: 'Host is not connected to an ATEM' }));
  // Deliberately no message handler: Viewer mode cannot issue ATEM commands.
  ws.on('close', () => viewerClients.delete(ws));
});
viewerServer.listen(VIEWER_PORT, VIEWER_HOST, () => {
  console.log(`ShowDesk read-only viewer service listening on ${VIEWER_HOST}:${VIEWER_PORT}`);
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
