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
  if (id === undefined || id === null) return '—';
  const input = state?.inputs?.[id];
  return input?.longName || input?.shortName || input?.externalPortType || `INPUT ${id}`;
}
function normalizeState(state) {
  if (!state) return null;
  const inputs = Object.entries(state.inputs || {}).map(([id, x]) => ({
    id: Number(id),
    name: x.longName || x.shortName || null,
    shortName: x.shortName || '',
    externalPortType: x.externalPortType ?? null,
    internalPortType: x.internalPortType ?? null,
    sourceAvailability: x.sourceAvailability ?? null,
    meAvailability: x.meAvailability ?? null
  }));
  const mixEffects = (state.video?.mixEffects || []).filter(Boolean).map((me, i) => ({
    index: i + 1,
    pgm: inputName(state, me.programInput),
    pvw: inputName(state, me.previewInput),
    transition: me.transitionPosition ? {
      inTransition: !!me.transitionPosition.inTransition,
      position: me.transitionPosition.handlePosition ?? null
    } : null,
    ftb: me.fadeToBlack ? { isFullyBlack: !!me.fadeToBlack.isFullyBlack, inTransition: !!me.fadeToBlack.inTransition } : null,
    upstreamKeyers: (me.upstreamKeyers || []).filter(Boolean).map((keyer, k) => ({
      index: k + 1,
      onAir: !!keyer.onAir,
      type: keyer.mixEffectKeyType ?? keyer.type ?? null,
      fill: inputName(state, keyer.fillSource),
      key: inputName(state, keyer.cutSource)
    }))
  }));
  const downstreamKeyers = (state.video?.downstreamKeyers || []).filter(Boolean).map((keyer, i) => ({
    index: i + 1,
    onAir: !!keyer.onAir,
    fill: inputName(state, keyer.sources?.fillSource ?? keyer.fillSource),
    key: inputName(state, keyer.sources?.cutSource ?? keyer.cutSource)
  }));
  const auxRaw = state.video?.auxilliaries || [];
  // ATEM exposes output destinations as input descriptors with InternalPortType.Auxiliary (129).
  // Their inputId is the protocol AUX bus id used by state.video.auxilliaries.
  // Resolve user-facing AUX identity from that authoritative metadata instead of array position.
  const auxDestinations = Object.values(state.inputs || {})
    .filter(x => Number(x.internalPortType) === 129)
    .sort((a, b) => Number(a.inputId) - Number(b.inputId));
  const auxNumberByBusId = new Map(auxDestinations.map((x, i) => [Number(x.inputId), i + 1]));
  const auxEntries = Object.entries(auxRaw).map(([key, source]) => {
    const busId = Number(key);
    const auxNumber = auxNumberByBusId.get(busId);
    return {
      rawKey: key,
      rawIndex: busId,
      busId,
      destinationType: auxNumber ? 'aux' : 'routing-bus',
      destinationNumber: auxNumber ?? null,
      name: auxNumber ? `AUX ${auxNumber}` : `ATEM ROUTING BUS ${key}`,
      route: inputName(state, source),
      sourceId: source
    };
  });
  // Do not infer physical output connectors from these values. They are exposed
  // as raw ATEM AUX bus state so a physical switcher can be compared 1:1.
  const aux = auxEntries;
  const capabilities = state.info?.capabilities || {};
  const me0 = mixEffects[0];
  return {
    pgm: me0?.pgm || '—', pvw: me0?.pvw || '—', inputs, aux, mixEffects, downstreamKeyers,
    topology: {
      reportedSources: inputs.length,
      reportedRoutingSlots: aux.length,
      reportedAuxBuses: aux.length,
      capabilitySources: capabilities.sources ?? null,
      capabilityAuxBuses: capabilities.auxilliaries ?? null,
      capabilityMixEffects: capabilities.mixEffects ?? null
    },
    productIdentifier: state.info?.productIdentifier || null,
    videoMode: state.settings?.videoMode ?? null,
    debug: {
      info: state.info || null,
      settings: state.settings || null,
      inputCount: Object.keys(state.inputs || {}).length,
      inputIds: Object.keys(state.inputs || {}).map(Number),
      auxiliaryDestinations: auxDestinations.map((x, i) => ({ auxNumber: i + 1, protocolBusId: Number(x.inputId), longName: x.longName || null, shortName: x.shortName || null, internalPortType: x.internalPortType, externalPortType: x.externalPortType })),
      mixEffects: (state.video?.mixEffects || []).filter(Boolean).map((me, i) => ({
        index: i + 1, programInput: me.programInput ?? null, previewInput: me.previewInput ?? null,
        upstreamKeyerCount: (me.upstreamKeyers || []).filter(Boolean).length
      })),
      auxilliaries: Object.entries(auxRaw).map(([key, source]) => ({
        rawKey: key,
        rawIndex: Number(key),
        protocolBusId: Number(key),
        sourceId: source,
        resolvedSource: inputName(state, source)
      })),
      outputInvestigation: {
        routingSlotCount: Object.keys(auxRaw).length,
        capabilities: capabilities,
        infoKeys: Object.keys(state.info || {}),
        settingsKeys: Object.keys(state.settings || {}),
        videoKeys: Object.keys(state.video || {}),
        note: 'Software Control AUX numbering is resolved from ATEM input descriptors whose internalPortType is Auxiliary (129); inputId is matched to the protocol AUX bus id.'
      }
    }
  };
}
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
    return discovery(discoveredState);
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
