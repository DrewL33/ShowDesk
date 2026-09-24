'use strict';

const assert = require('node:assert/strict');
const { normalizeState } = require('../src/atem-state');

assert.equal(normalizeState(null), null);

const state = {
  inputs: {
    1: { inputId: 1, longName: 'Camera 1', shortName: 'CAM1', internalPortType: 0, externalPortType: 1, sourceAvailability: 1, meAvailability: 3 },
    2: { inputId: 2, longName: 'Camera 2', shortName: 'CAM2', internalPortType: 0, externalPortType: 1, sourceAvailability: 1, meAvailability: 3 },
    15: { inputId: 15, longName: 'Announcements', shortName: 'ANN', internalPortType: 0, externalPortType: 1 },
    8001: { inputId: 8001, longName: 'Online', shortName: 'ONLINE', internalPortType: 129 },
    8002: { inputId: 8002, longName: 'InRoom', shortName: 'INROOM', internalPortType: 129 }
  },
  video: {
    mixEffects: [{
      programInput: 15,
      previewInput: 2,
      transitionPosition: { inTransition: true, handlePosition: 5000 },
      fadeToBlack: { isFullyBlack: true, inTransition: false },
      upstreamKeyers: [{ onAir: true, mixEffectKeyType: 1, fillSource: 1, cutSource: 2 }]
    }],
    downstreamKeyers: [{ onAir: true, sources: { fillSource: 2, cutSource: 1 } }],
    auxilliaries: { 0: 15, 1: 1 }
  },
  info: { productIdentifier: 'Test ATEM', capabilities: { sources: 5, auxilliaries: 2, mixEffects: 1 } },
  settings: { videoMode: 12 }
};

const result = normalizeState(state);
assert.equal(result.productIdentifier, 'Test ATEM');
assert.equal(result.videoMode, 12);
assert.equal(result.mixEffects[0].pgmId, 15);
assert.equal(result.mixEffects[0].pvwId, 2);
assert.deepEqual(result.mixEffects[0].ftb, { isFullyBlack: true, inTransition: false });
assert.equal(result.mixEffects[0].upstreamKeyers[0].fillId, 1);
assert.equal(result.mixEffects[0].upstreamKeyers[0].keyId, 2);
assert.equal(result.downstreamKeyers[0].fillId, 2);
assert.equal(result.downstreamKeyers[0].keyId, 1);
assert.deepEqual(result.aux.map(x => [x.busId, x.destinationId, x.name, x.sourceId]), [
  [0, 8001, 'Online', 15],
  [1, 8002, 'InRoom', 1]
]);
assert.equal(result.topology.capabilityAuxBuses, 2);
assert.equal(result.topology.reportedRoutingSlots, 2);
assert.ok(!Object.prototype.hasOwnProperty.call(result.aux[0], 'physicalOutput'));

console.log('ATEM state normalization regressions passed');
