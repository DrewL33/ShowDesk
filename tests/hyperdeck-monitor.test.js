'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const { HyperDeckMonitor, cleanConfig, parseResponseBlock } = require('../src/hyperdeck-monitor');

function waitFor(predicate, timeoutMs = 1500) {
  const end = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const poll = () => {
      if (predicate()) return resolve();
      if (Date.now() >= end) return reject(new Error('Timed out waiting for HyperDeck monitor state'));
      setTimeout(poll, 10);
    };
    poll();
  });
}

(async () => {
  assert.deepEqual(parseResponseBlock(['208 transport info:', 'status: play', 'display timecode: 01:02:03:04']), {
    code: 208, header: 'transport info', fields: { status: 'play', 'display timecode': '01:02:03:04' }
  });
  assert.throws(() => cleanConfig({ id: 'deck', name: 'Deck', host: 'bad-host' }), /IPv4 or IPv6/);
  assert.throws(() => cleanConfig({ id: 'deck', name: 'Deck', host: '192.168.1.2', port: 0 }), /Port/);

  const commands = [];
  const fakeDeck = net.createServer(socket => {
    let infoResponded = false;
    socket.write('500 connection info:\r\nprotocol version: 1.8\r\nmodel: HyperDeck Studio HD Plus\r\n\r\n');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        commands.push(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
      }
      if (!commands.includes('device info') || infoResponded) return;
      infoResponded = true;
      socket.write('204 device info:\r\nmodel: HyperDeck Studio HD Plus\r\ndevice name: Studio A\r\nsoftware version: 9.0\r\n\r\n');
      socket.write('208 transport info:\r\nstatus: play\r\ndisplay timecode: 01:02:03:04\r\nclip id: 12\r\n\r\n');
      socket.write('202 slot info:\r\nslot id: 1\r\nslot name: SDI\r\nstatus: mounted\r\nvolume name: SHOW DRIVE\r\nrecording time available: 3600\r\n\r\n');
    });
  });
  await new Promise(resolve => fakeDeck.listen(0, '127.0.0.1', resolve));
  const monitor = new HyperDeckMonitor();
  try {
    assert.equal(cleanConfig({ id: 'deck-default', host: '127.0.0.1', port: fakeDeck.address().port }).name, 'HyperDeck');
    assert.throws(() => monitor.configure([
      { id: 'deck-a', name: 'HyperDeck 1', host: '127.0.0.1', port: fakeDeck.address().port },
      { id: 'deck-b', name: 'HyperDeck 2', host: '127.0.0.1', port: fakeDeck.address().port }
    ]), /endpoint can only be configured once/);
    monitor.configure([{ id: 'deck1', name: 'Studio A', host: '127.0.0.1', port: fakeDeck.address().port }]);
    await waitFor(() => monitor.snapshot()[0]?.transport?.status === 'play' && monitor.snapshot()[0]?.slots?.length === 1);
    const deck = monitor.snapshot()[0];
    assert.equal(deck.model, 'HyperDeck Studio HD Plus');
    assert.equal(deck.error, '', 'The normal connection-info greeting is not an error');
    assert.equal(deck.deviceName, 'Studio A');
    assert.equal(deck.softwareVersion, '9.0');
    assert.equal(deck.transport['display timecode'], '01:02:03:04');
    assert.equal(deck.slots[0]['volume name'], 'SHOW DRIVE');
    const sent = commands;
    assert.deepEqual(sent.sort(), ['device info', 'notify: device info: true', 'notify: slot: true', 'notify: transport: true', 'slot info', 'transport info'].sort());
    assert(!sent.some(command => /^(play|stop|record|jog|shuttle|goto|preview|remote)$/.test(command)));
    const commandCount = commands.length;
    monitor.configure([{ id: 'deck1', name: 'Studio A - renamed', host: '127.0.0.1', port: fakeDeck.address().port }]);
    assert.equal(monitor.snapshot()[0].name, 'Studio A - renamed');
    assert.equal(monitor.snapshot()[0].status, 'connected');
    assert.equal(commands.length, commandCount, 'renaming a deck must not reconnect or reinitialize its socket');
    monitor.configure([]);
    assert.equal(monitor.snapshot().length, 0);
  } finally {
    monitor.close();
    await new Promise(resolve => fakeDeck.close(resolve));
  }
  process.stdout.write('hyperdeck-monitor.test.js passed\n');
})().catch(error => { console.error(error); process.exitCode = 1; });
