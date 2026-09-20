(() => {
  let socket = null;
  let seq = 0;
  const pending = new Map();
  const subscribers = new Set();

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
          const { resolve, reject } = pending.get(msg.replyTo);
          pending.delete(msg.replyTo);
          msg.ok ? resolve(msg.data) : reject(new Error(msg.error || 'ShowDesk service error'));
          return;
        }
        if (msg.type === 'state') subscribers.forEach(fn => fn(msg.data));
        if (msg.type === 'connection' && msg.status === 'disconnected') {
          console.warn('ATEM disconnected:', msg.reason || 'connection lost');
        }
      });
    });
  }

  async function request(type, payload = {}) {
    const ws = await ensureSocket();
    const id = `req-${Date.now()}-${++seq}`;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, type, ...payload }));
      setTimeout(() => {
        if (!pending.has(id)) return;
        pending.delete(id);
        reject(new Error('ShowDesk service timed out'));
      }, 12000);
    });
  }

  window.ATEM_TRANSPORT = {
    async connect(ip) {
      try { return await request('connect', { ip }); }
      catch (error) { console.error(error); return null; }
    },
    subscribe(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    async disconnect() { return request('disconnect'); }
  };
})();
