(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ui = {
    pill: $('connectionPill'), label: $('connectionLabel'), message: $('connectionMessage'),
    connect: $('connectButton'), model: $('modelName')
  };
  let socket = null;
  let reconnectTimer = null;
  let hadConnection = false;
  let latest = null;
  let previous = null;
  let changes = [];
  let selectedMeIndex = null;
  let selectedSignalNode = null;
  let connectionStatus = 'connecting';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function setConnection(status, message) {
    connectionStatus = status;
    ui.pill.dataset.status = status;
    ui.label.textContent = ({ connected: 'LIVE', waiting: 'WAITING', reconnecting: 'RECONNECTING', connecting: 'CONNECTING', error: 'OFFLINE' })[status] || status.toUpperCase();
    ui.message.textContent = message;
    ui.connect.hidden = status !== 'error';
    if (latest) renderInspect(latest);
  }
  function connectionUrl(value) {
    const target = String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
    if (!target) throw new Error('Enter the IP address of a ShowDesk Host.');
    let url;
    try { url = new URL(`ws://${target}`); } catch { throw new Error('Enter a valid host IP address, optionally followed by a port.'); }
    if (!url.hostname || url.username || url.password || url.pathname !== '/') throw new Error('Enter a valid host IP address, optionally followed by a port.');
    if (!url.port) url.port = '47822';
    url.pathname = '/viewer';
    return url.toString();
  }
  function socketConnect(value, reconnect = false) {
    clearTimeout(reconnectTimer);
    let url;
    try { url = connectionUrl(value); }
    catch (error) { setConnection('error', error.message); return; }
    if (!reconnect) hadConnection = false;
    if (socket) { socket.onclose = null; try { socket.close(); } catch {} }
    setConnection(reconnect ? 'reconnecting' : 'connecting', `Connecting to ${new URL(url).host}…`);
    const current = new WebSocket(url);
    socket = current;
    let receivedHostMessage = false;
    current.addEventListener('open', () => {
      if (socket !== current) return;
      receivedHostMessage = true;
    });
    current.addEventListener('message', event => {
      if (socket !== current) return;
      let message;
      try { message = JSON.parse(event.data); } catch { return; }
      receivedHostMessage = true;
      if (message.type === 'snapshot' && message.data) {
        hadConnection = true;
        renderState(message.data);
        setConnection('connected', `Live from ${message.data.ip || new URL(url).hostname} · updates automatically`);
      } else if (message.type === 'state' && message.data) {
        hadConnection = true;
        renderState(message.data);
        setConnection('connected', `Live from ${latest?.ip || new URL(url).hostname} · updates automatically`);
      } else if (message.type === 'connection' && message.status === 'waiting') {
        setConnection('waiting', message.reason || 'Host is waiting for an ATEM connection.');
      } else if (message.type === 'connection' && message.status === 'disconnected') {
        setConnection('reconnecting', message.reason || 'Switcher connection lost; waiting for the host…');
      } else if (message.type === 'health' && message.atemConnected === false && !latest) {
        setConnection('waiting', 'ShowDesk Host is online and waiting for an ATEM connection.');
      }
    });
    current.addEventListener('error', () => {
      if (socket !== current) return;
      if (!hadConnection) setConnection('error', `Could not reach ShowDesk at ${new URL(url).host}. Check the IP, port, network, and host firewall.`);
    });
    current.addEventListener('close', () => {
      if (socket !== current) return;
      socket = null;
      if (hadConnection) {
        setConnection('reconnecting', 'Connection interrupted. Reconnecting…');
        reconnectTimer = setTimeout(() => socketConnect(value, true), 2000);
      } else if (receivedHostMessage) {
        setConnection('error', 'The connection to ShowDesk Host closed. Tap Connect to try again.');
      }
    });
    const connectTimeout = setTimeout(() => {
      if (socket === current && current.readyState !== WebSocket.OPEN) {
        current.close();
        if (!hadConnection) setConnection('error', `Could not reach ShowDesk at ${new URL(url).host}. Check the IP, port, network, and host firewall.`);
      }
    }, 10000);
    current.addEventListener('open', () => clearTimeout(connectTimeout), { once: true });
  }

  function recordChanges(data) {
    if (!previous) { previous = data; return; }
    const add = (label, before, after) => {
      if (before !== after) changes.unshift({ time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), label, value: `${before} → ${after}` });
    };
    (data.mixEffects || []).forEach((me, index) => {
      const old = (previous.mixEffects || [])[index];
      if (!old) return;
      add(`M/E ${me.index} · PROGRAM`, old.pgm || '—', me.pgm || '—');
      add(`M/E ${me.index} · PREVIEW`, old.pvw || '—', me.pvw || '—');
    });
    (data.aux || []).forEach((route, index) => {
      const old = (previous.aux || [])[index];
      if (old) add(route.name || `AUX ${index + 1}`, old.route || '—', route.route || '—');
    });
    changes = changes.slice(0, 12);
    previous = data;
  }
  function renderChanges() {
    $('recentChanges').innerHTML = changes.length ? changes.map(item => `<div class="listRow"><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.value)}</small></div><time>${escapeHtml(item.time)}</time></div>`).join('') : '<p class="empty">No changes yet.</p>';
  }
  function renderShow(data) {
    const mixEffects = data.mixEffects || [];
    if (!mixEffects.some(me => Number(me.index) === Number(selectedMeIndex))) selectedMeIndex = Number(mixEffects[0]?.index) || null;
    $('meSelector').innerHTML = mixEffects.map(me => `<button type="button" data-me-index="${Number(me.index) || 1}" class="${Number(me.index) === Number(selectedMeIndex) ? 'is-selected' : ''}" aria-pressed="${Number(me.index) === Number(selectedMeIndex)}">M/E ${Number(me.index) || 1}</button>`).join('');
    const me = mixEffects.find(item => Number(item.index) === Number(selectedMeIndex)) || mixEffects[0];
    $('programSource').textContent = me?.pgm || data.pgm || '—';
    $('previewSource').textContent = me?.pvw || data.pvw || '—';
    $('programContext').textContent = me ? `M/E ${me.index}${me.ftb?.isFullyBlack ? ' · Fade to black' : ''}` : 'Program source';
    $('previewContext').textContent = me ? `M/E ${me.index} · Ready` : 'Preview source';
    const active = new Map();
    mixEffects.forEach(item => {
      [item.pgm, item.pvw].forEach((name, i) => { if (name && name !== '—') active.set(name, i ? 'PREVIEW' : 'PROGRAM'); });
      (item.upstreamKeyers || []).filter(key => key.onAir).forEach(key => {
        if (key.fill) active.set(key.fill, `M/E ${item.index} · KEY`);
        if (key.key) active.set(key.key, `M/E ${item.index} · KEY`);
      });
    });
    (data.downstreamKeyers || []).filter(key => key.onAir).forEach(key => { if (key.fill) active.set(key.fill, 'DSK · KEY'); });
    $('activeCount').textContent = `${active.size} ACTIVE`;
    $('activeSources').innerHTML = active.size ? Array.from(active.entries()).map(([name, role]) => `<div class="listRow"><div><strong>${escapeHtml(name)}</strong><small>${escapeHtml(role)}</small></div><span class="liveMark">LIVE</span></div>`).join('') : '<p class="empty">No active sources reported.</p>';
    renderChanges();
  }
  function graphReach(graph, id, reverse = false) {
    const seen = new Set([id]), queue = [id];
    while (queue.length) {
      const current = queue.shift();
      graph.edges.forEach(edge => {
        const from = reverse ? edge.to : edge.from, to = reverse ? edge.from : edge.to;
        if (from === current && !seen.has(to)) { seen.add(to); queue.push(to); }
      });
    }
    return seen;
  }
  function buildSignalGraph(data) {
    const inputs = data.inputs || [], mes = data.mixEffects || [], dsks = data.downstreamKeyers || [], routing = data.aux || [];
    const nodes = [], edges = [], byId = new Map(), internals = new Map(), edgeIds = new Set();
    const add = (id, label, type, group) => { if (!byId.has(id)) { const node = { id, label, type, group }; byId.set(id, node); nodes.push(node); } return id; };
    mes.forEach((me, i) => { const index = Number(me.index) || i + 1, base = 10000 + (index - 1) * 10; internals.set(base, { index, kind: 'program' }); internals.set(base + 1, { index, kind: 'preview' }); });
    const source = id => {
      const input = inputs.find(item => Number(item.id) === Number(id)), internal = internals.get(Number(id));
      if (internal) return add(`meout:${internal.index}:${internal.kind}`, input?.name || `M/E ${internal.index} ${internal.kind.toUpperCase()}`, 'internal', 'M/E INTERNAL OUTPUTS');
      return add(`src:${id}`, input?.name || `Source ${id}`, 'source', 'INPUTS');
    };
    inputs.forEach(input => source(input.id));
    const connect = (from, to, kind = 'selected') => {
      const id = `${from}->${to}`;
      if (from === to || edgeIds.has(id) || graphReach({ edges }, to).has(from)) return;
      edgeIds.add(id); edges.push({ id, from, to, kind });
    };
    const feed = (id, to, kind) => { if (id === undefined || id === null || !Number.isFinite(Number(id))) return; connect(source(id), to, kind); };
    mes.forEach(me => {
      const index = Number(me.index) || 1, base = 10000 + (index - 1) * 10;
      add(`me:${index}`, `M/E ${index} · Processing`, 'processor', 'M/E PROCESSORS');
      const pgmOut = source(base), pvwOut = source(base + 1);
      connect(`me:${index}`, pgmOut, 'program');
      add(`pgm:${index}`, `M/E ${index} · PGM`, 'bus', 'M/E BUSES');
      add(`pvw:${index}`, `M/E ${index} · Preview`, 'bus', 'M/E BUSES');
      feed(me.pgmId, `pgm:${index}`, 'program'); feed(me.pvwId, `pvw:${index}`, 'preview');
      connect(`pgm:${index}`, `me:${index}`, 'program'); connect(`pvw:${index}`, pvwOut, 'preview');
      (me.upstreamKeyers || []).forEach(key => {
        const fill = add(`uskfill:${index}:${key.index}`, `M/E ${index} · USK ${key.index} Fill`, 'bus', 'M/E BUSES & ASSIGNMENTS');
        const cut = add(`uskkey:${index}:${key.index}`, `M/E ${index} · USK ${key.index} Key`, 'bus', 'M/E BUSES & ASSIGNMENTS');
        feed(key.fillId, fill, 'assigned'); feed(key.keyId, cut, 'assigned');
      });
    });
    dsks.forEach(key => {
      const fill = add(`dskfill:${key.index}`, `DSK ${key.index} · Fill`, 'destination', 'DESTINATIONS');
      const cut = add(`dskkey:${key.index}`, `DSK ${key.index} · Key`, 'destination', 'DESTINATIONS');
      feed(key.fillId, fill, 'assigned'); feed(key.keyId, cut, 'assigned');
    });
    routing.forEach((route, i) => {
      const id = add(`aux:${route.busId ?? route.rawIndex ?? i}`, route.name || `ATEM Routing ${i + 1}`, 'destination', 'DESTINATIONS');
      feed(route.sourceId, id, 'routing');
    });
    return { nodes, edges };
  }
  const edgeMeaning = kind => ({ program: 'PROGRAM', preview: 'PREVIEW', assigned: 'ASSIGNED · VERIFY KEYER ON AIR', routing: 'OUTPUT ROUTE', selected: 'ROUTE' })[kind] || 'ROUTE';
  function renderSignal(data) {
    const graph = buildSignalGraph(data), query = $('signalSearch').value.trim().toLowerCase();
    const matchingNodes = graph.nodes.filter(node => !query || node.label.toLowerCase().includes(query));
    const searchRelated = new Set(); matchingNodes.forEach(node => { graphReach(graph, node.id, true).forEach(id => searchRelated.add(id)); graphReach(graph, node.id).forEach(id => searchRelated.add(id)); });
    const pinned = selectedSignalNode && graph.nodes.some(node => node.id === selectedSignalNode) ? selectedSignalNode : null;
    const trace = pinned ? new Set([...graphReach(graph, pinned, true), ...graphReach(graph, pinned)]) : null;
    const groups = ['INPUTS', 'M/E BUSES', 'M/E BUSES & ASSIGNMENTS', 'M/E PROCESSORS', 'M/E INTERNAL OUTPUTS', 'DESTINATIONS'];
    const content = groups.map(group => {
      const nodes = graph.nodes.filter(node => node.group === group && (!query || searchRelated.has(node.id)));
      if (!nodes.length) return '';
      const cards = nodes.map(node => {
        const incoming = graph.edges.filter(edge => edge.to === node.id), outgoing = graph.edges.filter(edge => edge.from === node.id);
        const isConnected = incoming.length + outgoing.length > 0;
        const isTraced = !trace || trace.has(node.id);
        const links = incoming.map(edge => `<div class="signalLink in ${edge.kind}"><span>←</span><b>${escapeHtml(graph.nodes.find(item => item.id === edge.from)?.label || edge.from)}</b><small>${escapeHtml(edgeMeaning(edge.kind))}</small></div>`).concat(outgoing.map(edge => `<div class="signalLink out ${edge.kind}"><span>→</span><b>${escapeHtml(graph.nodes.find(item => item.id === edge.to)?.label || edge.to)}</b><small>${escapeHtml(edgeMeaning(edge.kind))}</small></div>`)).join('');
        return `<article class="signalNode ${isConnected ? '' : 'is-unlinked'} ${isTraced ? '' : 'is-dimmed'} ${pinned === node.id ? 'is-traced' : ''}"><button type="button" data-signal-node="${escapeHtml(node.id)}" aria-pressed="${pinned === node.id}">${escapeHtml(node.label)}</button><span class="signalNodeMeta">${isConnected ? `${incoming.length} IN · ${outgoing.length} OUT` : 'UNLINKED'}</span><div class="signalLinks">${links || '<small>No reported connections</small>'}</div></article>`;
      }).join('');
      return `<section class="signalGroup"><h2>${escapeHtml(group)}</h2>${cards}</section>`;
    }).join('');
    $('signalContent').innerHTML = `<div class="signalLegend"><span>PROGRAM / PREVIEW = live M/E feeds</span><span>ASSIGNED = assignment, check keyer state</span><span>OUTPUT ROUTE = AUX</span></div>${content || `<p class="empty">${query ? 'No signal nodes match that search.' : 'No signal paths reported yet.'}</p>`}`;
  }
  function renderInspect(data) {
    const inputs = data.inputs || [], mes = data.mixEffects || [], aux = data.aux || [], keys = [...mes.flatMap(me => (me.upstreamKeyers || []).map(key => ({ ...key, label: `M/E ${me.index} · USK ${key.index}` }))), ...(data.downstreamKeyers || []).map(key => ({ ...key, label: `DSK ${key.index}` }))];
    $('summaryGrid').innerHTML = [[data.name || data.productIdentifier || 'ATEM', 'SWITCHER'], [inputs.length, 'INPUTS'], [mes.length, 'M/E'], [aux.length, 'AUX ROUTES']].map(([value, label]) => `<div class="summaryTile"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div>`).join('');
    $('inputCount').textContent = `${inputs.length} INPUT${inputs.length === 1 ? '' : 'S'}`;
    $('inputInventory').innerHTML = inputs.length ? inputs.map(input => `<div class="listRow"><div><strong>${escapeHtml(input.name || input.shortName || `Input ${input.id}`)}</strong><small>${escapeHtml(input.shortName || `INPUT ${input.id}`)} · ID ${escapeHtml(input.id)}</small></div><span class="typeTag">${escapeHtml(input.externalPortType ?? 'SOURCE')}</span></div>`).join('') : '<p class="empty">No inputs reported.</p>';
    $('keyerInventory').innerHTML = keys.length ? keys.map(key => `<div class="listRow"><div><strong>${escapeHtml(key.label)}</strong><small>${escapeHtml(key.fill || 'Fill —')}${key.key ? ` · ${escapeHtml(key.key)}` : ''}</small></div><span class="stateTag ${key.onAir ? 'is-on' : ''}">${key.onAir ? 'ON AIR' : 'OFF'}</span></div>`).join('') : '<p class="empty">No keyers reported.</p>';
    $('auxCount').textContent = `${aux.length} ROUTE${aux.length === 1 ? '' : 'S'}`;
    $('auxInventory').innerHTML = aux.length ? aux.map(route => `<div class="listRow"><div><strong>${escapeHtml(route.name || `AUX ${Number(route.busId) + 1}`)}</strong><small>Source · ${escapeHtml(route.route || '—')}</small></div><span class="typeTag">AUX</span></div>`).join('') : '<p class="empty">No AUX routes reported.</p>';
    $('matrixCount').textContent = `${inputs.length} SOURCE${inputs.length === 1 ? '' : 'S'}`;
    $('mobileMatrix').innerHTML = inputs.length ? inputs.map(input => {
      const badges = [];
      mes.forEach(me => {
        if (me.pgm === input.name) badges.push(`<span class="matrixBadge pgm">M/E ${me.index} · PGM</span>`);
        if (me.pvw === input.name) badges.push(`<span class="matrixBadge pvw">M/E ${me.index} · PVW</span>`);
      });
      keys.filter(key => key.fill === input.name || key.key === input.name).forEach(key => badges.push(`<span class="matrixBadge key">${escapeHtml(key.label)}</span>`));
      aux.filter(route => route.route === input.name).forEach(route => badges.push(`<span class="matrixBadge route">${escapeHtml(route.name || `AUX ${Number(route.busId) + 1}`)}</span>`));
      return `<div class="matrixSourceRow"><strong>${escapeHtml(input.name || input.shortName || `Input ${input.id}`)}</strong><div class="matrixBadges">${badges.join('') || '<span class="typeTag">NO CURRENT ROUTES</span>'}</div></div>`;
    }).join('') : '<p class="empty">No input or routing state reported.</p>';
    const videoModes = { 0:['525i59.94','59.94i'],1:['625i50','50i'],2:['525i59.94 16:9','59.94i'],3:['625i50 16:9','50i'],4:['720p50','50 fps'],5:['720p59.94','59.94 fps'],6:['1080i50','50i'],7:['1080i59.94','59.94i'],8:['1080p23.98','23.98 fps'],9:['1080p24','24 fps'],10:['1080p25','25 fps'],11:['1080p29.97','29.97 fps'],12:['1080p50','50 fps'],13:['1080p59.94','59.94 fps'],14:['2160p23.98','23.98 fps'],15:['2160p24','24 fps'],16:['2160p25','25 fps'],17:['2160p29.97','29.97 fps'],18:['2160p50','50 fps'],19:['2160p59.94','59.94 fps'],20:['4320p23.98','23.98 fps'],21:['4320p24','24 fps'],22:['4320p25','25 fps'],23:['4320p29.97','29.97 fps'],24:['4320p50','50 fps'],25:['4320p59.94','59.94 fps'],26:['1080p30','30 fps'],27:['1080p60','60 fps'] };
    const video = videoModes[Number(data.videoMode)] || [data.videoMode ?? '—', '—'];
    const activeFtb = mes.filter(me => me.ftb && (me.ftb.isFullyBlack || me.ftb.inTransition)).map(me => `M/E ${me.index}${me.ftb.inTransition ? ' · TRANSITION' : ' · BLACK'}`);
    const liveKeyers = keys.filter(key => key.onAir).length;
    const metrics = [
      ['HOST LINK', connectionStatus.toUpperCase(), connectionStatus === 'connected' ? '' : 'warning'],
      ['VIDEO MODE', video[0], ''], ['FRAME RATE', video[1], ''],
      ['M/E BLOCKS', mes.length, ''], ['SOURCES', inputs.length, ''], ['ROUTING DESTINATIONS', aux.length, ''],
      ['KEYERS ON AIR', liveKeyers, liveKeyers ? 'warning' : ''], ['FTB ACTIVE', activeFtb.join(', ') || 'NONE', activeFtb.length ? 'warning' : '']
    ];
    $('diagnostics').innerHTML = metrics.map(([label, value, kind]) => `<div class="diagnosticCell ${kind}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong></div>`).join('');
  }
  function renderState(data) {
    if (!data) return;
    recordChanges(data);
    latest = data;
    ui.model.textContent = data.name || data.productIdentifier || 'MOBILE VIEWER';
    renderShow(data);
    renderSignal(data);
    renderInspect(data);
  }
  function selectTab(name) {
    document.querySelectorAll('.tabButton').forEach(button => {
      const selected = button.dataset.tab === name;
      button.classList.toggle('is-active', selected);
      button.setAttribute('aria-selected', selected ? 'true' : 'false');
    });
    document.querySelectorAll('.tabPage').forEach(page => {
      const selected = page.id === `${name}Tab`;
      page.classList.toggle('is-active', selected);
      page.hidden = !selected;
    });
  }
  document.addEventListener('click', event => {
    const tab = event.target.closest('[data-tab]');
    if (tab) selectTab(tab.dataset.tab);
    const meButton = event.target.closest('[data-me-index]');
    if (meButton && latest) { selectedMeIndex = Number(meButton.dataset.meIndex); renderShow(latest); }
    const signalButton = event.target.closest('[data-signal-node]');
    if (signalButton && latest) { selectedSignalNode = selectedSignalNode === signalButton.dataset.signalNode ? null : signalButton.dataset.signalNode; renderSignal(latest); }
  });
  ui.connect.addEventListener('click', () => { if (location.hostname) socketConnect(location.hostname); });
  $('signalSearch').addEventListener('input', () => { if (latest) renderSignal(latest); });

  if (location.hostname) {
    setTimeout(() => socketConnect(location.hostname), 150);
  } else {
    setConnection('error', 'Open this viewer from the ShowDesk Host address in your browser.');
  }
})();
