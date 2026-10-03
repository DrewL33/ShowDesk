(() => {
  let socket = null;
  let viewerSocket = null;
  let seq = 0;
  const pending = new Map();
  const subscribers = new Set();
  const connectionSubscribers = new Set();

  function isNativeTauri() {
    return !!window.__TAURI_INTERNALS__;
  }

  function serviceUrl() {
    if (isNativeTauri()) return 'ws://127.0.0.1:47821/ws';
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
    if (socket && socket.readyState === WebSocket.OPEN) return socket;
    await ensureNativeService();
    if (socket && socket.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        socket.addEventListener('open', () => resolve(socket), { once: true });
        socket.addEventListener('error', () => reject(new Error('ShowDesk ATEM service could not be reached after native startup.')), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      socket = new WebSocket(serviceUrl());
      socket.addEventListener('open', () => resolve(socket), { once: true });
      socket.addEventListener('error', () => reject(new Error('ShowDesk ATEM service could not be reached after native startup.')), { once: true });
      socket.addEventListener('message', (event) => {
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
      });
      socket.addEventListener('close', () => {
        socket = null;
        for (const [id, item] of pending) {
          clearTimeout(item.timer);
          item.reject(new Error('ShowDesk service connection closed'));
          pending.delete(id);
        }
      });
    });
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

  async function connectViewer(host) {
    const target = host.trim().replace(/^wss?:\/\//, '').replace(/\/$/, '');
    const url = `ws://${target.includes(':') ? target : target + ':47822'}/viewer`;
    return new Promise((resolve, reject) => {
      const viewer = new WebSocket(url);
      viewerSocket = viewer;
      let settled = false;
      const timer = setTimeout(() => { if (!settled) { settled = true; viewer.close(); reject(new Error('ShowDesk Host did not respond in time')); } }, 10000);
      viewer.addEventListener('error', () => { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('Unable to reach ShowDesk Host at ' + target)); } });
      viewer.addEventListener('message', event => {
        let msg; try { msg = JSON.parse(event.data); } catch { return; }
        if (msg.type === 'snapshot' && !settled) {
          settled = true; clearTimeout(timer); socket = viewer; resolve({ status:'connected', data:msg.data });
        } else if (msg.type === 'state') subscribers.forEach(fn => fn(msg.data));
        else if (msg.type === 'connection') { connectionSubscribers.forEach(fn => fn(msg)); if (!settled && msg.status === 'waiting') { settled=true; clearTimeout(timer); socket=viewer; resolve({status:'waiting',reason:msg.reason}); } }
      });
      viewer.addEventListener('close', () => {
        if (socket === viewer) socket = null;
        if (viewerSocket === viewer) viewerSocket = null;
        if (settled) connectionSubscribers.forEach(fn => fn({ type:'connection', status:'disconnected', reason:'ShowDesk Host connection lost' }));
      });
    });
  }

  window.ATEM_TRANSPORT = {
    connect(ip) { return request('connect', { ip }); },
    connectViewer(host) { return connectViewer(host); },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    subscribeConnection(callback) {
      connectionSubscribers.add(callback);
      return () => connectionSubscribers.delete(callback);
    },
    disconnect() { return request('disconnect'); },
    disconnectViewer() {
      const viewer = viewerSocket;
      viewerSocket = null;
      if (viewer) { try { viewer.close(); } catch {} }
      if (socket === viewer) socket = null;
      return Promise.resolve({ disconnected:true });
    }
  };
})();
