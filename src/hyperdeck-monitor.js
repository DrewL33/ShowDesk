'use strict';

const net = require('node:net');
const { EventEmitter } = require('node:events');

const MAX_DECKS = 8;
const MAX_BUFFER = 64 * 1024;
const MAX_LINE = 4096;
const RECONNECT_MAX_MS = 30_000;

function cleanConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Invalid HyperDeck configuration');
  const id = String(config.id || '').slice(0, 64);
  const name = String(config.name || 'HyperDeck').trim().slice(0, 64) || 'HyperDeck';
  const host = String(config.host || '').trim();
  const port = Number(config.port ?? 9993);
  if (!/^[\w-]{1,64}$/.test(id)) throw new Error('Invalid HyperDeck id');
  if (!name) throw new Error('Enter a name for this HyperDeck');
  if (net.isIP(host) === 0) throw new Error('Enter a valid HyperDeck IPv4 or IPv6 address');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be between 1 and 65535');
  return { id, name, host, port };
}

function parseResponseBlock(lines) {
  if (!lines.length) return null;
  const match = /^(\d{3})\s+([^:]+):(?:\s*(.*))?$/.exec(lines[0]);
  if (!match) return null;
  const fields = {};
  if (match[3]) fields.message = match[3];
  for (const line of lines.slice(1)) {
    const field = /^([^:]+):\s*(.*)$/.exec(line);
    if (field) fields[field[1].trim().toLowerCase()] = field[2].trim();
  }
  return { code: Number(match[1]), header: match[2].trim().toLowerCase(), fields };
}

class HyperDeckMonitor extends EventEmitter {
  constructor({ connect = net.createConnection, reconnectMinMs = 2000, transportPollIntervalMs = 1000, staleTimeoutMs = 5000 } = {}) {
    super();
    this.connect = connect;
    this.reconnectMinMs = reconnectMinMs;
    this.transportPollIntervalMs = transportPollIntervalMs;
    this.staleTimeoutMs = staleTimeoutMs;
    this.entries = new Map();
  }

  configure(configs) {
    if (!Array.isArray(configs) || configs.length > MAX_DECKS) throw new Error(`Configure no more than ${MAX_DECKS} HyperDecks`);
    const normalized = configs.map(cleanConfig);
    if (new Set(normalized.map(item => item.id)).size !== normalized.length) throw new Error('HyperDeck IDs must be unique');
    const endpoints = normalized.map(item => `${item.host.toLowerCase()}:${item.port}`);
    if (new Set(endpoints).size !== endpoints.length) throw new Error('A HyperDeck network endpoint can only be configured once');
    const keep = new Set(normalized.map(item => item.id));
    for (const id of this.entries.keys()) if (!keep.has(id)) this.remove(id);
    for (const config of normalized) {
      const existing = this.entries.get(config.id);
      if (existing && existing.config.host === config.host && existing.config.port === config.port) {
        existing.config = config;
        continue;
      }
      if (existing) this.remove(config.id);
      const entry = { config, socket: null, retry: null, retryMs: this.reconnectMinMs, transportPoll: null, slotPoll: null, connectedAt: 0, buffer: '', lines: [], info: {}, transport: {}, transportUpdatedAt: 0, slotsUpdatedAt: 0, frontDisplayTimecode: '', recordingElapsedMs: 0, recordingStartedAt: null, displayTimecodeNotifications: false, slots: {}, status: 'connecting', error: '' };
      this.entries.set(config.id, entry);
      this.open(entry);
    }
    this.publish();
    return this.snapshot();
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    this.entries.delete(id);
    clearTimeout(entry.retry);
    clearTimeout(entry.connectTimer);
    clearInterval(entry.transportPoll);
    clearInterval(entry.slotPoll);
    entry.socket?.destroy();
    this.publish();
  }

  snapshot() {
    return [...this.entries.values()].map(entry => ({
      id: entry.config.id, name: entry.config.name, host: entry.config.host, port: entry.config.port,
      status: entry.status, error: entry.error, model: entry.info.model || '', deviceName: entry.info['device name'] || '',
      softwareVersion: entry.info['software version'] || entry.info['firmware version'] || entry.info['software revision'] || '', protocolVersion: entry.info['protocol version'] || '',
      deviceInfo: { ...entry.info }, transport: { ...entry.transport }, transportUpdatedAt: entry.transportUpdatedAt, slotsUpdatedAt: entry.slotsUpdatedAt, frontDisplayTimecode: entry.frontDisplayTimecode, recordingElapsedMs: entry.recordingElapsedMs + (entry.recordingStartedAt === null ? 0 : Math.max(0, Date.now() - entry.recordingStartedAt)), slots: Object.values(entry.slots).filter(slot => String(slot.id || '').trim().toLowerCase() !== 'none' && !['empty', 'unknown'].includes(String(slot.status || '').trim().toLowerCase()) && String(slot.status || '').trim() !== '').sort((a, b) => String(a.id).localeCompare(String(b.id), undefined, { numeric: true }))
    }));
  }

  publish() { this.emit('state', this.snapshot()); }

  open(entry) {
    if (!this.entries.has(entry.config.id)) return;
    entry.status = 'connecting'; entry.error = ''; this.publish();
    const socket = this.connect({ host: entry.config.host, port: entry.config.port });
    entry.socket = socket;
    entry.connectTimer = setTimeout(() => socket.destroy(new Error('HyperDeck connection timed out')), 10_000);
    entry.connectTimer.unref?.();
    socket.on('connect', () => { if (entry.socket !== socket) return; clearTimeout(entry.connectTimer); entry.connectTimer = null; entry.connectedAt = Date.now(); entry.status = 'connected'; entry.retryMs = this.reconnectMinMs; this.publish(); });
    socket.on('data', data => { if (entry.socket === socket) this.consume(entry, data); });
    socket.on('error', error => { if (entry.socket === socket) entry.error = String(error.message || error).slice(0, 160); });
    socket.on('close', () => {
      if (entry.socket !== socket) return;
      clearTimeout(entry.connectTimer); entry.connectTimer = null;
      clearInterval(entry.transportPoll); entry.transportPoll = null;
      clearInterval(entry.slotPoll); entry.slotPoll = null;
      entry.displayTimecodeNotifications = false;
      if (entry.recordingStartedAt !== null) { entry.recordingElapsedMs += Math.max(0, Date.now() - entry.recordingStartedAt); entry.recordingStartedAt = null; }
      entry.socket = null; entry.connectedAt = 0; entry.status = 'disconnected'; this.publish();
      if (this.entries.has(entry.config.id)) {
        entry.retry = setTimeout(() => this.open(entry), entry.retryMs);
        entry.retry.unref?.(); entry.retryMs = Math.min(RECONNECT_MAX_MS, entry.retryMs * 2);
      }
    });
  }

  consume(entry, data) {
    entry.buffer += data.toString('utf8');
    if (entry.buffer.length > MAX_BUFFER) { entry.socket?.destroy(new Error('HyperDeck response exceeded the safe buffer limit')); return; }
    let newline;
    while ((newline = entry.buffer.indexOf('\n')) >= 0) {
      const line = entry.buffer.slice(0, newline).replace(/\r$/, '');
      entry.buffer = entry.buffer.slice(newline + 1);
      if (line.length > MAX_LINE) { entry.socket?.destroy(new Error('HyperDeck response line too long')); return; }
      if (line === '') {
        const response = parseResponseBlock(entry.lines); entry.lines = [];
        if (response) this.onResponse(entry, response);
      } else entry.lines.push(line);
    }
  }

  onResponse(entry, response) {
    const welcome = response.code === 500 && response.header === 'connection info';
    const asyncInfo = response.code >= 500 && response.code < 600 && ['device info', 'transport info', 'slot info', 'display timecode'].includes(response.header);
    if (response.code >= 400 && response.code < 600 && !welcome && !asyncInfo) {
      entry.error = (response.fields.message || response.header).slice(0, 160);
    } else if (response.code < 400 || welcome) {
      entry.error = '';
    }
    const f = response.fields;
    if (response.header === 'connection info' || response.header === 'device info') {
      entry.info = { ...entry.info, ...f };
      if (entry.info.model || entry.info['device name']) entry.status = 'connected';
    } else if (response.header === 'transport info') {
      entry.transportUpdatedAt = Date.now();
      const wasRecording = String(entry.transport.status || '').toLowerCase() === 'record';
      const nextStatus = String(f.status || entry.transport.status || '').toLowerCase();
      const isRecording = nextStatus === 'record';
      const now = Date.now();
      if (isRecording && !wasRecording) { entry.recordingElapsedMs = 0; entry.recordingStartedAt = now; }
      else if (isRecording && entry.recordingStartedAt === null) entry.recordingStartedAt = now;
      else if (!isRecording && entry.recordingStartedAt !== null) { entry.recordingElapsedMs += Math.max(0, now - entry.recordingStartedAt); entry.recordingStartedAt = null; }
      const transportFields = { ...f };
      if (isRecording && f['display timecode']) entry.frontDisplayTimecode = f['display timecode'];
      else if (!entry.frontDisplayTimecode && f['display timecode']) entry.frontDisplayTimecode = f['display timecode'];
      if (entry.frontDisplayTimecode && !isRecording) transportFields['display timecode'] = entry.frontDisplayTimecode;
      entry.transport = { ...entry.transport, ...transportFields };
      if (isRecording && !entry.displayTimecodeNotifications) {
        this.send(entry, 'notify: display timecode: true');
        entry.displayTimecodeNotifications = true;
      } else if (!isRecording && wasRecording && entry.displayTimecodeNotifications) {
        this.send(entry, 'notify: display timecode: false');
        entry.displayTimecodeNotifications = false;
      }
    } else if (response.header === 'display timecode') {
      const timecode = f['display timecode'] || f.timecode || f.message || '';
      if (String(entry.transport.status || '').toLowerCase() === 'record' && timecode) {
        entry.frontDisplayTimecode = timecode;
        entry.transport['display timecode'] = timecode;
      }
    } else if (response.header === 'slot info') {
      entry.slotsUpdatedAt = Date.now();
      const id = f['slot id'] || f['slot name'] || '';
      if (id && id.toLowerCase() !== 'none') {
        if (String(f.status || '').toLowerCase() === 'empty') {
          delete entry.slots[id];
        } else {
          const slot = { ...entry.slots[id], ...f, id };
          // Blackmagic's protocol names this value "recording time"; keep the
          // normalized API key used by ShowDesk's monitor UI for older clients.
          if (slot['recording time'] !== undefined && slot['recording time available'] === undefined) {
            slot['recording time available'] = slot['recording time'];
          }
          delete slot['recording time'];
          entry.slots[id] = slot;
        }
      }
    }
    this.syncTransportPolling(entry);
    this.publish();
    if (response.code === 500 && response.header === 'connection info') {
      this.send(entry, 'notify: slot: true');
      this.send(entry, 'notify: device info: true');
      this.send(entry, 'notify: transport: true');
      this.send(entry, 'device info');
      this.send(entry, 'transport info');
      this.send(entry, 'slot info');
    }
  }

  send(entry, command) {
    // This allowlist keeps the monitor read-only: no transport or recording commands.
    if (!['notify: slot: true', 'notify: device info: true', 'notify: transport: true', 'notify: display timecode: true', 'notify: display timecode: false', 'device info', 'transport info', 'slot info'].includes(command)) return;
    if (entry.socket?.writable) entry.socket.write(`${command}\r\n`);
  }

  syncTransportPolling(entry) {
    if (entry.socket?.writable && !entry.transportPoll) {
      entry.transportPoll = setInterval(() => {
        const now = Date.now(), baseline = entry.connectedAt || now;
        // A previous socket's last-reply timestamp must not make a newly
        // reconnected socket look stale before its first status replies land.
        const transportAt = Math.max(entry.transportUpdatedAt, baseline), slotsAt = Math.max(entry.slotsUpdatedAt, baseline);
        if (now - transportAt > this.staleTimeoutMs || now - slotsAt > this.staleTimeoutMs) {
          entry.socket?.destroy(new Error('HyperDeck stopped replying to status requests; reconnecting'));
          return;
        }
        this.send(entry, 'transport info');
      }, this.transportPollIntervalMs);
      entry.transportPoll.unref?.();
    } else if (!entry.socket?.writable && entry.transportPoll) {
      clearInterval(entry.transportPoll);
      entry.transportPoll = null;
    }
    // Slot capacity can change while recording even when some HyperDeck
    // models report a transport state other than `record` (for example,
    // linked decks or preview-oriented states). Keep the read-only slot
    // query running for every connected deck so the SSD time-left value does
    // not depend on the transport status being reported consistently.
    if (entry.socket?.writable && !entry.slotPoll) {
      entry.slotPoll = setInterval(() => this.send(entry, 'slot info'), this.transportPollIntervalMs);
      entry.slotPoll.unref?.();
    } else if (!entry.socket?.writable && entry.slotPoll) {
      clearInterval(entry.slotPoll);
      entry.slotPoll = null;
    }
  }

  close() {
    for (const id of [...this.entries.keys()]) this.remove(id);
  }
}

module.exports = { HyperDeckMonitor, cleanConfig, parseResponseBlock, MAX_DECKS };
