'use strict';

function inputName(state, id) {
  if (id === undefined || id === null) return '—';
  const input = state?.inputs?.[id];
  return input?.longName || input?.shortName || input?.externalPortType || `INPUT ${id}`;
}
function normalizeState(state) {
  if (!state) return null;
  const inputs = Object.entries(state.inputs || {}).map(([id, x]) => ({
    id: Number(id),
    name: x.longName || x.shortName || null,
    shortName: x.shortName || '',
    externalPortType: x.externalPortType ?? null,
    internalPortType: x.internalPortType ?? null,
    sourceAvailability: x.sourceAvailability ?? null,
    meAvailability: x.meAvailability ?? null
  }));
  const mixEffects = (state.video?.mixEffects || []).filter(Boolean).map((me, i) => ({
    index: i + 1,
    pgm: inputName(state, me.programInput),
    pgmId: me.programInput ?? null,
    pvw: inputName(state, me.previewInput),
    pvwId: me.previewInput ?? null,
    transition: me.transitionPosition ? {
      inTransition: !!me.transitionPosition.inTransition,
      position: me.transitionPosition.handlePosition ?? null
    } : null,
    ftb: me.fadeToBlack ? { isFullyBlack: !!me.fadeToBlack.isFullyBlack, inTransition: !!me.fadeToBlack.inTransition } : null,
    upstreamKeyers: (me.upstreamKeyers || []).filter(Boolean).map((keyer, k) => ({
      index: k + 1,
      onAir: !!keyer.onAir,
      type: keyer.mixEffectKeyType ?? keyer.type ?? null,
      fill: inputName(state, keyer.fillSource),
      fillId: keyer.fillSource ?? null,
      key: inputName(state, keyer.cutSource),
      keyId: keyer.cutSource ?? null
    }))
  }));
  const downstreamKeyers = (state.video?.downstreamKeyers || []).filter(Boolean).map((keyer, i) => ({
    index: i + 1,
    onAir: !!keyer.onAir,
    fill: inputName(state, keyer.sources?.fillSource ?? keyer.fillSource),
    fillId: keyer.sources?.fillSource ?? keyer.fillSource ?? null,
    key: inputName(state, keyer.sources?.cutSource ?? keyer.cutSource),
    keyId: keyer.sources?.cutSource ?? keyer.cutSource ?? null
  }));
  const auxRaw = state.video?.auxilliaries || [];
  // ATEM exposes output destinations as input descriptors with InternalPortType.Auxiliary (129).
  // Their inputId is the protocol AUX bus id used by state.video.auxilliaries.
  // Resolve user-facing AUX identity from that authoritative metadata instead of array position.
  const auxDestinations = Object.values(state.inputs || {})
    .filter(x => Number(x.internalPortType) === 129)
    .sort((a, b) => Number(a.inputId) - Number(b.inputId));
  // The protocol AUX state is indexed by destination ordinal, while the matching
  // destination descriptors use a separate inputId namespace (for example 8001+).
  // Pair them by the ATEM-reported destination order and preserve the descriptor name.
  const auxEntries = Object.entries(auxRaw).map(([key, source]) => {
    const busId = Number(key);
    const destination = auxDestinations[busId] || null;
    const destinationName = destination?.longName || destination?.shortName || null;
    return {
      rawKey: key,
      rawIndex: busId,
      busId,
      destinationId: destination ? Number(destination.inputId) : null,
      destinationType: destination ? 'auxiliary-destination' : 'routing-bus',
      destinationNumber: busId + 1,
      name: destinationName || `ATEM ROUTING BUS ${key}`,
      route: inputName(state, source),
      sourceId: source
    };
  });
  // Do not infer physical output connectors from these values. They are exposed
  // as raw ATEM AUX bus state so a physical switcher can be compared 1:1.
  const aux = auxEntries;
  const capabilities = state.info?.capabilities || {};
  const me0 = mixEffects[0];
  return {
    pgm: me0?.pgm || '—', pvw: me0?.pvw || '—', inputs, aux, mixEffects, downstreamKeyers,
    topology: {
      reportedSources: inputs.length,
      reportedRoutingSlots: aux.length,
      reportedAuxBuses: aux.length,
      capabilitySources: capabilities.sources ?? null,
      capabilityAuxBuses: capabilities.auxilliaries ?? null,
      capabilityMixEffects: capabilities.mixEffects ?? null
    },
    productIdentifier: state.info?.productIdentifier || null,
    videoMode: state.settings?.videoMode ?? null,
    debug: {
      info: state.info || null,
      settings: state.settings || null,
      inputCount: Object.keys(state.inputs || {}).length,
      inputIds: Object.keys(state.inputs || {}).map(Number),
      auxiliaryDestinations: auxDestinations.map((x, i) => ({ routingBusId: i, destinationId: Number(x.inputId), displayName: x.longName || x.shortName || null, longName: x.longName || null, shortName: x.shortName || null, internalPortType: x.internalPortType, externalPortType: x.externalPortType })),
      mixEffects: (state.video?.mixEffects || []).filter(Boolean).map((me, i) => ({
        index: i + 1, programInput: me.programInput ?? null, previewInput: me.previewInput ?? null,
        upstreamKeyerCount: (me.upstreamKeyers || []).filter(Boolean).length
      })),
      auxilliaries: Object.entries(auxRaw).map(([key, source]) => ({
        rawKey: key,
        rawIndex: Number(key),
        protocolBusId: Number(key),
        sourceId: source,
        resolvedSource: inputName(state, source)
      })),
      outputInvestigation: {
        routingSlotCount: Object.keys(auxRaw).length,
        capabilities: capabilities,
        infoKeys: Object.keys(state.info || {}),
        settingsKeys: Object.keys(state.settings || {}),
        videoKeys: Object.keys(state.video || {}),
        note: 'Routing bus ordinals are paired with ATEM Auxiliary (129) destination descriptors in ATEM-reported order; descriptor names are preserved as the user-facing destination identity.'
      }
    }
  };
}

module.exports = { inputName, normalizeState };
