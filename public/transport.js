(() => {
  let socket = null;
  let seq = 0;
  const pending = new Map();
  const subscribers = new Set();
  const connectionSubscribers = new Set();

  function ensureSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) return Promise.resolve(socket);
    if (socket && socket.readyState === WebSocket.CONNECTING) {
      return new Promise((resolve, reject) => {
        socket.addEventListener('open', () => resolve(socket), { once: true });
        socket.addEventListener('error', reject, { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${proto}//${location.host}/ws`);
      socket.addEventListener('open', () => resolve(socket), { once: true });
      socket.addEventListener('error', reject, { once: true });
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

  window.ATEM_TRANSPORT = {
    connect(ip) { return request('connect', { ip }); },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    subscribeConnection(callback) {
      connectionSubscribers.add(callback);
      return () => connectionSubscribers.delete(callback);
    },
    disconnect() { return request('disconnect'); }
  };
})();
