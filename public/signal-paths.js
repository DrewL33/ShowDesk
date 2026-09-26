'use strict';

function createSignalPathTracer({ inputs = [], mixEffects = [], downstreamKeyers = [], routing = [] }) {
  const meOutputFor = me => {
    const candidates = inputs.filter(x => Number(x.internalPortType) === 128);
    const exact = candidates.find(x => Number(x.meAvailability) === Math.pow(2, me.index - 1));
    if (exact) return exact;
    return candidates.find(x => {
      const n = ((x.name || '') + ' ' + (x.shortName || '')).toLowerCase();
      return n.includes('m/e ' + me.index) || n.includes('me ' + me.index) || n.includes('me' + me.index);
    }) || null;
  };

  const directUses = id => {
    const out = [];
    mixEffects.forEach(me => {
      if (Number(me.pgmId) === Number(id)) out.push({ kind: 'program', label: 'M/E ' + me.index + ' · PROGRAM', me, ftb: me.ftb });
      if (Number(me.pvwId) === Number(id)) out.push({ kind: 'preview', label: 'M/E ' + me.index + ' · PREVIEW' });
      (me.upstreamKeyers || []).forEach(k => {
        if (Number(k.fillId) === Number(id) || Number(k.keyId) === Number(id)) {
          out.push({ kind: 'direct', label: 'M/E ' + me.index + ' · USK ' + k.index + ' · ' + (Number(k.fillId) === Number(id) ? 'FILL' : 'KEY') });
        }
      });
    });
    downstreamKeyers.forEach(k => {
      if (Number(k.fillId) === Number(id) || Number(k.keyId) === Number(id)) {
        out.push({ kind: 'direct', label: 'DSK ' + k.index + ' · ' + (Number(k.fillId) === Number(id) ? 'FILL' : 'KEY') });
      }
    });
    routing.forEach(r => {
      if (Number(r.sourceId) === Number(id)) out.push({ kind: 'route', label: r.name || ('ATEM ROUTING BUS ' + (r.busId ?? r.protocolBusId ?? r.rawIndex)), sub: '' });
    });
    return out;
  };

  const descendants = (id, visited = new Set()) => {
    const n = Number(id);
    if (visited.has(n)) return [];
    const next = new Set(visited);
    next.add(n);
    return directUses(n).map(use => {
      if (!use.me || use.kind !== 'program') return { ...use, children: [] };
      const output = meOutputFor(use.me);
      return { ...use, children: output ? descendants(output.id, next) : [] };
    });
  };

  return { descendants, directUses, meOutputFor };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { createSignalPathTracer };
if (typeof window !== 'undefined') window.ShowDeskSignalPaths = { createSignalPathTracer };
