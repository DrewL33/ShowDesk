(() => {
  let serviceSocket = null;
  let viewerSocket = null;
  let seq = 0;
  const pending = new Map();
  const subscribers = new Set();
  const connectionSubscribers = new Set();
  const healthSubscribers = new Set();
  const viewerCountSubscribers = new Set();
  const hyperdeckSubscribers = new Set();
  const hyperdeckAvailabilitySubscribers = new Set();
  let serviceReconnectEnabled = false;
  let serviceReconnectTimer = null;
  let serviceReconnectInFlight = false;

  const HEARTBEAT_TIMEOUT_MS = 15000;
  function monitorSocketLiveness(ws, onStale) {
    let lastMessageAt = Date.now();
    const timer = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastMessageAt >= HEARTBEAT_TIMEOUT_MS) {
        clearInterval(timer);
        onStale();
      }
    }, 5000);
    return { received() { lastMessageAt = Date.now(); }, stop() { clearInterval(timer); } };
  }

  function isNativeTauri() {
    return !!window.__TAURI_INTERNALS__;
  }

  function serviceUrl() {
    if (isNativeTauri()) return `ws://127.0.0.1:${window.SHOWDESK_CONFIG?.servicePort || 47821}/ws`;
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  async function ensureNativeService() {
    if (!isNativeTauri()) return;
    const invoke = window.__TAURI_INTERNALS__?.invoke;
    if (typeof invoke !== 'function') {
      throw new Error('Native ShowDesk service bridge is unavailable.');
    }
    try {
      await invoke('ensure_atem_service');
    } catch (error) {
      throw new Error(typeof error === 'string' ? error : (error?.message || String(error)));
    }
  }

  async function ensureSocket() {
    serviceReconnectEnabled = true;
    if (serviceSocket && serviceSocket.readyState === WebSocket.OPEN) return serviceSocket;
    await ensureNativeService();
    if (serviceSocket && serviceSocket.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        serviceSocket.addEventListener('open', () => resolve(serviceSocket), { once: true });
        serviceSocket.addEventListener('error', () => reject(new Error('ShowDesk ATEM service could not be reached after native startup.')), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(serviceUrl());
      serviceSocket = ws;
      const liveness = monitorSocketLiveness(ws, () => {
        try { ws.close(4000, 'ShowDesk heartbeat timed out'); } catch { ws.close(); }
      });
      ws.addEventListener('open', () => resolve(ws), { once: true });
      ws.addEventListener('error', () => reject(new Error('ShowDesk ATEM service could not be reached after native startup.')), { once: true });
      ws.addEventListener('message', (event) => {
        liveness.received();
        let msg;
        try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.replyTo && pending.has(msg.replyTo)) {
          const { resolve, reject, timer } = pending.get(msg.replyTo);
          clearTimeout(timer);
          pending.delete(msg.replyTo);
          msg.ok ? resolve(msg.data) : reject(new Error(msg.error || 'ShowDesk service error'));
          return;
        }
        if (msg.type === 'state') subscribers.forEach(fn => fn(msg.data));
        if (msg.type === 'connection') connectionSubscribers.forEach(fn => fn(msg));
        if (msg.type === 'health') healthSubscribers.forEach(fn => fn(msg));
        if (msg.type === 'viewerCount') viewerCountSubscribers.forEach(fn => fn(msg.count));
        if (msg.type === 'hyperdecks') hyperdeckSubscribers.forEach(fn => fn(msg.data || []));
        if (msg.type === 'hyperdeckAvailability') hyperdeckAvailabilitySubscribers.forEach(fn => fn(msg.enabled === true));
      });
      ws.addEventListener('close', () => {
        liveness.stop();
        if (serviceSocket === ws) serviceSocket = null;
        for (const [id, item] of pending) {
          clearTimeout(item.timer);
          item.reject(new Error('ShowDesk service connection closed'));
          pending.delete(id);
        }
        scheduleServiceReconnect();
      });
    });
  }

  function scheduleServiceReconnect() {
    if (!serviceReconnectEnabled || serviceReconnectTimer || serviceReconnectInFlight) return;
    serviceReconnectTimer = setTimeout(async () => {
      serviceReconnectTimer = null;
      if (!serviceReconnectEnabled || serviceReconnectInFlight) return;
      serviceReconnectInFlight = true;
      try { await ensureSocket(); } catch {}
      finally {
        serviceReconnectInFlight = false;
        if (serviceReconnectEnabled && (!serviceSocket || serviceSocket.readyState !== WebSocket.OPEN)) scheduleServiceReconnect();
      }
    }, 2000);
  }

  async function request(type, payload = {}) {
    const ws = await ensureSocket();
    const id = `req-${Date.now()}-${++seq}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('ShowDesk service did not respond in time'));
      }, 20000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, type, ...payload }));
    });
  }

  let viewerReconnectTimer = null, viewerReconnectHost = null, viewerReconnectEnabled = false, viewerReconnectInFlight = false;
  function stopViewerReconnect(){ viewerReconnectEnabled=false; viewerReconnectHost=null; viewerReconnectInFlight=false; if(viewerReconnectTimer){clearTimeout(viewerReconnectTimer);viewerReconnectTimer=null;} }
  function scheduleViewerReconnect(){ if(!viewerReconnectEnabled||!viewerReconnectHost||viewerReconnectTimer||viewerReconnectInFlight)return; connectionSubscribers.forEach(fn=>fn({type:'connection',status:'reconnecting',reason:'ShowDesk Host connection lost'})); viewerReconnectTimer=setTimeout(async()=>{viewerReconnectTimer=null;if(!viewerReconnectEnabled||viewerReconnectInFlight)return;viewerReconnectInFlight=true;try{await connectViewer(viewerReconnectHost,true);}catch{}finally{viewerReconnectInFlight=false;if(viewerReconnectEnabled&&!viewerSocket)scheduleViewerReconnect();}},2000); }

  async function connectViewer(host, reconnecting = false) {
    const target = host.trim().replace(/^wss?:\/\//, '').replace(/\/$/, '');
    if(!reconnecting){stopViewerReconnect();viewerReconnectEnabled=true;viewerReconnectHost=host;}
    const url = `ws://${target.includes(':') ? target : target + ':' + (window.SHOWDESK_CONFIG?.viewerPort || 47822)}/viewer`;
    return new Promise((resolve, reject) => {
      const viewer = new WebSocket(url);
      viewerSocket = viewer;
      const liveness = monitorSocketLiveness(viewer, () => {
        try { viewer.close(4000, 'ShowDesk Host heartbeat timed out'); } catch { viewer.close(); }
      });
      let settled = false;
      let waitingForAtem = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; viewer.close(); reject(new Error('ShowDesk Host did not respond in time')); } }, 10000);
      viewer.addEventListener('error', () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Unable to reach ShowDesk Host at ' + target)); } });
      viewer.addEventListener('message', event => {
        liveness.received();
        let msg; try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'snapshot') {
          const wasWaiting=waitingForAtem;
          waitingForAtem=false;
          if(!settled){settled=true;clearTimeout(timer);resolve({status:'connected',data:msg.data});}
          viewerReconnectEnabled=true;viewerReconnectHost=host;
          connectionSubscribers.forEach(fn=>fn({type:'connection',status:'viewer-connected',data:msg.data,reconnected:reconnecting||wasWaiting}));
        } else if (msg.type === 'state') subscribers.forEach(fn => fn(msg.data));
        else if (msg.type === 'connection') { if(msg.status==='waiting'||msg.status==='disconnected')waitingForAtem=true;connectionSubscribers.forEach(fn => fn(msg)); if (!settled && msg.status === 'waiting') { settled=true; clearTimeout(timer); resolve({status:'waiting',reason:msg.reason}); } }
        else if (msg.type === 'health') healthSubscribers.forEach(fn => fn(msg));
        else if (msg.type === 'hyperdecks') hyperdeckSubscribers.forEach(fn => fn(msg.data || []));
        else if (msg.type === 'hyperdeckAvailability') hyperdeckAvailabilitySubscribers.forEach(fn => fn(msg.enabled === true));
      });
      viewer.addEventListener('close', () => {
        liveness.stop();
        if (viewerSocket === viewer) viewerSocket = null;
        if (settled && viewerReconnectEnabled) scheduleViewerReconnect();
      });
    });
  }

  window.ATEM_TRANSPORT = {
    attach() { return ensureSocket(); },
    connect(ip) { return request('connect', { ip }); },
    configureHyperdecks(devices, enabled = Array.isArray(devices) && devices.length > 0) { return request('configureHyperdecks', { devices, enabled }); },
    subscribeHyperdecks(callback) { hyperdeckSubscribers.add(callback); return () => hyperdeckSubscribers.delete(callback); },
    subscribeHyperdeckAvailability(callback) { hyperdeckAvailabilitySubscribers.add(callback); return () => hyperdeckAvailabilitySubscribers.delete(callback); },
    publishReferenceAttention(data) { return request('referenceAttention', { data }); },
    connectViewer(host) { return connectViewer(host); },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    subscribeConnection(callback) {
      connectionSubscribers.add(callback);
      return () => connectionSubscribers.delete(callback);
    },
    subscribeHealth(callback) {
      healthSubscribers.add(callback);
      return () => healthSubscribers.delete(callback);
    },
    subscribeViewerCount(callback) {
      viewerCountSubscribers.add(callback);
      return () => viewerCountSubscribers.delete(callback);
    },
    disconnect() { return request('disconnect'); },
    disconnectViewer() {
      stopViewerReconnect();
      const viewer = viewerSocket;
      viewerSocket = null;
      if (viewer) { try { viewer.close(); } catch {} }
      return Promise.resolve({ disconnected:true });
    }
  };
})();
