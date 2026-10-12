'use strict';

function createLatestStateCoalescer(onValue, delayMs = 100, schedule = setTimeout, cancel = clearTimeout) {
  let timer = null;
  let latest;

  function flush() {
    if (timer !== null) cancel(timer);
    timer = null;
    if (latest === undefined) return;
    const value = latest;
    latest = undefined;
    onValue(value);
  }

  return {
    schedule(value) {
      latest = value;
      if (timer !== null) return;
      timer = schedule(() => {
        timer = null;
        flush();
      }, delayMs);
    },
    flush,
    clear() {
      if (timer !== null) cancel(timer);
      timer = null;
      latest = undefined;
    }
  };
}

module.exports = { createLatestStateCoalescer };
