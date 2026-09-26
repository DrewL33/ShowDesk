'use strict';
const assert = require('assert');

const { createSignalPathTracer } = require('../public/signal-paths');
const buildSignalGraph = data => createSignalPathTracer(data).descendants;

const inputs=[
 {id:15,name:'Announcements',internalPortType:0},
 {id:10010,name:'M/E 1 Program',shortName:'ME1PGM',internalPortType:128,meAvailability:1},
 {id:10020,name:'M/E 2 Program',shortName:'ME2PGM',internalPortType:128,meAvailability:2}
];
const mes=[
 {index:1,pgmId:10020,pvwId:1,ftb:{isFullyBlack:false,inTransition:false},upstreamKeyers:[]},
 {index:2,pgmId:15,pvwId:2,ftb:{isFullyBlack:true,inTransition:false},upstreamKeyers:[]}
];
const routing=[
 {sourceId:10020,name:'InRoom'},
 {sourceId:10020,name:'Output 11'},
 {sourceId:10020,name:'Side Screens'},
 {sourceId:10020,name:'IMAG 2'},
 {sourceId:15,name:'Aux 4'},
 {sourceId:15,name:'Aux 6 - Hall TVs'}
];
const trace=buildSignalGraph({inputs,mixEffects:mes,routing})(15);
assert.deepStrictEqual(trace.map(x=>x.label),['M/E 2 · PROGRAM','Aux 4','Aux 6 - Hall TVs']);
const me2=trace[0];
assert.strictEqual(me2.ftb.isFullyBlack,true);
assert.deepStrictEqual(me2.children.map(x=>x.label),['M/E 1 · PROGRAM','InRoom','Output 11','Side Screens','IMAG 2']);

// Preview, USK and DSK remain direct consumers.
const extra=buildSignalGraph({
 inputs,
 mixEffects:[{index:1,pgmId:99,pvwId:15,upstreamKeyers:[{index:1,fillId:15,keyId:7}]}],
 downstreamKeyers:[{index:1,fillId:15,keyId:8}],
 routing:[]
})(15);
assert.deepStrictEqual(extra.map(x=>x.label),['M/E 1 · PREVIEW','M/E 1 · USK 1 · FILL','DSK 1 · FILL']);

// Cycles must terminate.
const cycleInputs=[...inputs,{id:30,name:'Loop',internalPortType:0}];
const cycleMes=[{index:1,pgmId:10020,upstreamKeyers:[]},{index:2,pgmId:10010,upstreamKeyers:[]}];
const cycle=buildSignalGraph({inputs:cycleInputs,mixEffects:cycleMes})(10010);
assert.ok(JSON.stringify(cycle).length < 5000);
console.log('signal-path regressions passed');
