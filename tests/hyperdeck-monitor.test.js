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
  let fakeSocket;
  let transportStatus = 'record';
  let displayTimecodeNotifications = false;
  const fakeDeck = net.createServer(socket => {
    fakeSocket = socket;
    let infoResponded = false;
    let transportInfoCount = 0;
    let slotInfoCount = 0;
    socket.write('500 connection info:\r\nprotocol version: 1.8\r\nmodel: HyperDeck Studio HD Plus\r\n\r\n');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk.toString();
      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        commands.push(buffer.slice(0, index).replace(/\r$/, ''));
        buffer = buffer.slice(index + 1);
      }
      if (commands.includes('device info') && !infoResponded) {
        infoResponded = true;
        socket.write('204 device info:\r\nmodel: HyperDeck Studio HD Plus\r\ndevice name: Studio A\r\nsoftware version: 9.0\r\n\r\n');
      }
      if (commands.includes('notify: display timecode: true') && !displayTimecodeNotifications) {
        displayTimecodeNotifications = true;
        socket.write('508 display timecode:\r\ntimecode: 14:25:02;37\r\n\r\n');
      }
      if (commands.includes('notify: display timecode: false')) displayTimecodeNotifications = false;
      const transportCommands = commands.filter(command => command === 'transport info').length;
      if (transportCommands > transportInfoCount) {
        transportInfoCount = transportCommands;
        const clipTimecode = transportInfoCount === 1 ? '00:00:00:01' : '00:00:00:02';
        const displayTimecode = `14:25:02;${String(22 + transportInfoCount).padStart(2, '0')}`;
        socket.write(`208 transport info:\r\nstatus: ${transportStatus}\r\ntimecode: ${clipTimecode}\r\ndisplay timecode: ${displayTimecode}\r\nclip id: 12\r\n\r\n`);
      }
      const slotCommands = commands.filter(command => command === 'slot info').length;
      if (slotCommands > slotInfoCount) {
        slotInfoCount = slotCommands;
        socket.write(`202 slot info:\r\nslot id: 1\r\nslot name: SDI\r\nstatus: mounted\r\nvolume name: SHOW DRIVE\r\nrecording time available: ${3600 - slotInfoCount}\r\n\r\n`);
      }
    });
  });
  await new Promise(resolve => fakeDeck.listen(0, '127.0.0.1', resolve));
  const monitor = new HyperDeckMonitor({ transportPollIntervalMs: 25 });
  try {
    assert.equal(cleanConfig({ id: 'deck-default', host: '127.0.0.1', port: fakeDeck.address().port }).name, 'HyperDeck');
    assert.throws(() => monitor.configure([
      { id: 'deck-a', name: 'HyperDeck 1', host: '127.0.0.1', port: fakeDeck.address().port },
      { id: 'deck-b', name: 'HyperDeck 2', host: '127.0.0.1', port: fakeDeck.address().port }
    ]), /endpoint can only be configured once/);
    monitor.configure([{ id: 'deck1', name: 'Studio A', host: '127.0.0.1', port: fakeDeck.address().port }]);
    await waitFor(() => monitor.snapshot()[0]?.transport?.status === 'record' && monitor.snapshot()[0]?.slots?.length === 1);
    const deck = monitor.snapshot()[0];
    assert(deck.recordingElapsedMs < 250, 'The recording elapsed timer starts near zero when recording is first detected');
    assert.equal(deck.model, 'HyperDeck Studio HD Plus');
    assert.equal(deck.error, '', 'The normal connection-info greeting is not an error');
    assert.equal(deck.deviceName, 'Studio A');
    assert.equal(deck.softwareVersion, '9.0');
    assert.equal(deck.slots[0]['volume name'], 'SHOW DRIVE');
    await waitFor(() => monitor.snapshot()[0]?.frontDisplayTimecode === '14:25:02;37');
    assert.match(monitor.snapshot()[0].transport['display timecode'], /^14:25:02;\d+$/, 'The recording counter should match the current front display timecode');
    assert.notEqual(monitor.snapshot()[0].slots[0]['recording time available'], '3600', 'The SSD recording-time countdown should refresh during recording');
    assert.equal(monitor.snapshot()[0].error, '', 'Asynchronous timecode updates are normal status, not connection errors');
    await waitFor(() => monitor.snapshot()[0]?.transport?.timecode === '00:00:00:02');
    await waitFor(() => monitor.snapshot()[0]?.recordingElapsedMs >= 25);
    assert(commands.filter(command => command === 'transport info').length > 1, 'A connected deck should receive periodic read-only transport info requests');
    assert.notEqual(monitor.snapshot()[0].transport.timecode, monitor.snapshot()[0].transport['display timecode'], 'Clip and front-panel display timecode remain distinct');
    assert(monitor.entries.get('deck1').transportPoll, 'A connected deck should periodically refresh transport state');
    assert(monitor.entries.get('deck1').displayTimecodeNotifications, 'Frame-level front display notifications should be enabled during recording');
    fakeSocket.write('508 display timecode:\r\ntimecode: 14:25:02;45\r\n\r\n');
    await waitFor(() => monitor.snapshot()[0]?.frontDisplayTimecode === '14:25:02;45');
    transportStatus = 'preview';
    fakeSocket.write('508 transport info:\r\nstatus: preview\r\ntimecode: 00:00:00:02\r\ndisplay timecode: 14:25:02;46\r\n\r\n');
    await waitFor(() => monitor.snapshot()[0]?.transport?.status === 'preview');
    const stoppedRecordingElapsedMs = monitor.snapshot()[0].recordingElapsedMs;
    assert.equal(monitor.snapshot()[0].frontDisplayTimecode, '14:25:02;45', 'The counter should hold the last recording frame when recording stops');
    assert.equal(monitor.snapshot()[0].transport['display timecode'], '14:25:02;45', 'Expanded transport information should hold the same frozen recording value');
    assert.equal(monitor.entries.get('deck1').displayTimecodeNotifications, false, 'Frame notifications should be disabled when recording stops');
    assert(monitor.entries.get('deck1').transportPoll, 'Transport-state polling should continue in preview mode');
    assert.equal(monitor.entries.get('deck1').slotPoll, null, 'SSD time-remaining polling should stop when the deck is no longer recording');
    fakeSocket.write('508 display timecode:\r\ntimecode: 14:25:03;00\r\n\r\n');
    await new Promise(resolve => setTimeout(resolve, 60));
    assert.equal(monitor.snapshot()[0].recordingElapsedMs, stoppedRecordingElapsedMs, 'Recording elapsed holds its value when recording stops');
    assert.equal(monitor.snapshot()[0].frontDisplayTimecode, '14:25:02;45', 'A linked deck timecode must not move this stopped deck counter');
    const sent = commands;
    assert.deepEqual([...new Set(sent)].sort(), ['device info', 'notify: device info: true', 'notify: display timecode: false', 'notify: display timecode: true', 'notify: slot: true', 'notify: transport: true', 'slot info', 'transport info'].sort());
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
