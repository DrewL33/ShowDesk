'use strict';

const assert = require('node:assert/strict');
const { createLatestStateCoalescer } = require('../src/state-coalescer');

let nextTimer = 0;
const timers = new Map();
const schedule = callback => { const id = ++nextTimer; timers.set(id, callback); return id; };
const cancel = id => timers.delete(id);
const runNext = () => {
  const [id, callback] = timers.entries().next().value;
  timers.delete(id);
  callback();
};

const received = [];
const coalescer = createLatestStateCoalescer(value => received.push(value), 100, schedule, cancel);
coalescer.schedule({ sequence: 1 });
coalescer.schedule({ sequence: 2 });
coalescer.schedule({ sequence: 3 });
assert.equal(timers.size, 1, 'a burst should schedule only one publish');
runNext();
assert.deepEqual(received, [{ sequence: 3 }], 'a burst should publish only its latest state');

coalescer.schedule({ sequence: 4 });
coalescer.clear();
assert.equal(timers.size, 0, 'clear should cancel a pending publish');
assert.deepEqual(received, [{ sequence: 3 }], 'clear should discard a stale state');

coalescer.schedule({ sequence: 5 });
coalescer.flush();
assert.deepEqual(received, [{ sequence: 3 }, { sequence: 5 }], 'flush should publish the latest state immediately');
assert.equal(timers.size, 0, 'flush should cancel its pending timer');

console.log('state coalescer regressions passed');
