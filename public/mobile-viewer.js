(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const ui = {
    pill: $('connectionPill'), label: $('connectionLabel'), message: $('connectionMessage'),
    host: $('hostAddress'), connect: $('connectButton'), model: $('modelName')
  };
  let socket = null;
  let reconnectTimer = null;
  let hadConnection = false;
  let latest = null;
  let previous = null;
  let changes = [];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function setConnection(status, message) {
    ui.pill.dataset.status = status;
    ui.label.textContent = ({ connected: 'LIVE', waiting: 'WAITING', reconnecting: 'RECONNECTING', connecting: 'CONNECTING', error: 'OFFLINE' })[status] || status.toUpperCase();
    ui.message.textContent = message;
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
    ui.connect.disabled = true;
    setConnection(reconnect ? 'reconnecting' : 'connecting', `Connecting to ${new URL(url).host}…`);
    const current = new WebSocket(url);
    socket = current;
    let receivedHostMessage = false;
    current.addEventListener('open', () => {
      if (socket !== current) return;
      receivedHostMessage = true;
      ui.connect.disabled = false;
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
      ui.connect.disabled = false;
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
        ui.connect.disabled = false;
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
    const me = (data.mixEffects || [])[0];
    $('programSource').textContent = me?.pgm || data.pgm || '—';
    $('previewSource').textContent = me?.pvw || data.pvw || '—';
    $('programContext').textContent = me ? `M/E ${me.index}${me.ftb?.isFullyBlack ? ' · Fade to black' : ''}` : 'Program source';
    $('previewContext').textContent = me ? `M/E ${me.index} · Ready` : 'Preview source';
    const active = new Map();
    (data.mixEffects || []).forEach(item => {
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
  function routeCard(title, rows) {
    if (!rows.length) return '';
    return `<div class="card"><div class="cardTitle"><h2>${escapeHtml(title)}</h2><span>${rows.length} PATH${rows.length === 1 ? '' : 'S'}</span></div><div class="stack">${rows.map(row => `<div class="signalRow"><strong>${escapeHtml(row.from)}</strong><span class="signalArrow">↓</span><div><b>${escapeHtml(row.to)}</b><small>${escapeHtml(row.label)}</small></div></div>`).join('')}</div></div>`;
  }
  function renderSignal(data) {
    const query = $('signalSearch').value.trim().toLowerCase();
    const matches = row => !query || `${row.from} ${row.to} ${row.label}`.toLowerCase().includes(query);
    const meRows = [];
    (data.mixEffects || []).forEach(me => {
      if (me.pgm && me.pgm !== '—') meRows.push({ from: me.pgm, to: `M/E ${me.index} · PROGRAM`, label: 'Program bus' });
      if (me.pvw && me.pvw !== '—') meRows.push({ from: me.pvw, to: `M/E ${me.index} · PREVIEW`, label: 'Preview bus' });
      (me.upstreamKeyers || []).forEach(key => {
        if (key.onAir) [key.fill && { from: key.fill, to: `M/E ${me.index} · USK ${key.index}`, label: 'Fill · on air' }, key.key && { from: key.key, to: `M/E ${me.index} · USK ${key.index}`, label: 'Key · on air' }].filter(Boolean).forEach(x => meRows.push(x));
      });
    });
    const auxRows = (data.aux || []).map(route => ({ from: route.route || '—', to: route.name || `AUX ${Number(route.busId) + 1}`, label: 'AUX route' }));
    const dskRows = (data.downstreamKeyers || []).filter(key => key.onAir).flatMap(key => [key.fill && { from: key.fill, to: `DSK ${key.index}`, label: 'Fill · on air' }, key.key && { from: key.key, to: `DSK ${key.index}`, label: 'Key · on air' }].filter(Boolean));
    const content = [routeCard('M/E SIGNALS', meRows.filter(matches)), routeCard('DOWNSTREAM KEYS', dskRows.filter(matches)), routeCard('AUX OUTPUTS', auxRows.filter(matches))].filter(Boolean).join('');
    $('signalContent').innerHTML = content || `<p class="empty">${query ? 'No signal paths match that search.' : 'No signal paths reported yet.'}</p>`;
  }
  function renderInspect(data) {
    const inputs = data.inputs || [], mes = data.mixEffects || [], aux = data.aux || [], keys = [...mes.flatMap(me => (me.upstreamKeyers || []).map(key => ({ ...key, label: `M/E ${me.index} · USK ${key.index}` }))), ...(data.downstreamKeyers || []).map(key => ({ ...key, label: `DSK ${key.index}` }))];
    $('summaryGrid').innerHTML = [[data.name || data.productIdentifier || 'ATEM', 'SWITCHER'], [inputs.length, 'INPUTS'], [mes.length, 'M/E'], [aux.length, 'AUX ROUTES']].map(([value, label]) => `<div class="summaryTile"><strong>${escapeHtml(value)}</strong><small>${escapeHtml(label)}</small></div>`).join('');
    $('inputCount').textContent = `${inputs.length} INPUT${inputs.length === 1 ? '' : 'S'}`;
    $('inputInventory').innerHTML = inputs.length ? inputs.map(input => `<div class="listRow"><div><strong>${escapeHtml(input.name || input.shortName || `Input ${input.id}`)}</strong><small>${escapeHtml(input.shortName || `INPUT ${input.id}`)} · ID ${escapeHtml(input.id)}</small></div><span class="typeTag">${escapeHtml(input.externalPortType ?? 'SOURCE')}</span></div>`).join('') : '<p class="empty">No inputs reported.</p>';
    $('keyerInventory').innerHTML = keys.length ? keys.map(key => `<div class="listRow"><div><strong>${escapeHtml(key.label)}</strong><small>${escapeHtml(key.fill || 'Fill —')}${key.key ? ` · ${escapeHtml(key.key)}` : ''}</small></div><span class="stateTag ${key.onAir ? 'is-on' : ''}">${key.onAir ? 'ON AIR' : 'OFF'}</span></div>`).join('') : '<p class="empty">No keyers reported.</p>';
    $('auxCount').textContent = `${aux.length} ROUTE${aux.length === 1 ? '' : 'S'}`;
    $('auxInventory').innerHTML = aux.length ? aux.map(route => `<div class="listRow"><div><strong>${escapeHtml(route.name || `AUX ${Number(route.busId) + 1}`)}</strong><small>Source · ${escapeHtml(route.route || '—')}</small></div><span class="typeTag">AUX</span></div>`).join('') : '<p class="empty">No AUX routes reported.</p>';
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
  });
  $('hostForm').addEventListener('submit', event => {
    event.preventDefault();
    const value = ui.host.value.trim();
    if (!value) { setConnection('error', 'Enter the IP address of a ShowDesk Host.'); return; }
    socketConnect(value);
  });
  $('signalSearch').addEventListener('input', () => { if (latest) renderSignal(latest); });

  if (location.hostname) {
    ui.host.value = location.hostname;
    setTimeout(() => socketConnect(location.hostname), 150);
  } else {
    ui.connect.disabled = false;
    setConnection('waiting', 'Enter the IP address of a ShowDesk Host to connect.');
  }
})();
