'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('public/app.js','utf8');
const styles=fs.readFileSync('public/styles.css','utf8');
const start=app.indexOf('function explorerReach(');
const end=app.indexOf('function transitionPercent(',start);
assert.ok(start>=0&&end>start,'Signal Explorer functions should remain available');
const context={
 liveEngineering:null,
 explorerEscape:value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]))
};
const explorer=vm.runInNewContext(app.slice(start,end)+'\n({explorerBuildGraph,explorerReach,explorerTrace,explorerDraw})',context);
const focusStart=app.indexOf('function explorerFocusId('),focusEnd=app.indexOf('function explorerClear(',focusStart);
assert.ok(focusStart>=0&&focusEnd>focusStart,'Signal Explorer focus state should remain testable');
const focus=vm.runInNewContext('let explorerPinned=null,explorerHover=null;'+app.slice(focusStart,focusEnd)+'\n({explorerFocusId,explorerInspect})',{explorerHighlight(){}});
focus.explorerInspect('Media Player 3 Key',true);
focus.explorerInspect('Camera 1',false);
assert.equal(focus.explorerFocusId(),'Camera 1','The visible hover label and highlighted route must always refer to the same node');
focus.explorerInspect(null,false);
assert.equal(focus.explorerFocusId(),'Media Player 3 Key','Moving away from a hover preview should restore the pinned route');
focus.explorerInspect('Media Player 3 Key',true);
assert.equal(focus.explorerFocusId(),'Media Player 3 Key','Unpinning under the pointer should keep that node as the hover preview');
focus.explorerInspect(null,false);
assert.equal(focus.explorerFocusId(),null,'Leaving an unpinned hover preview should clear the trace');

const traceGraph={edges:[
 {id:'source-a',from:'source-a',to:'bus-a'},
 {id:'bus-a',from:'bus-a',to:'selected'},
 {id:'selected-pgm',from:'selected',to:'processor'},
 {id:'processor-output',from:'processor',to:'output'},
 {id:'branch',from:'source-b',to:'other-bus'},
 {id:'inactive-assignment',from:'source-a',to:'uskfill:1:1',kind:'assigned'},
 {id:'active-assignment',from:'source-a',to:'uskfill:1:2',kind:'assigned',traceable:true},
 {id:'active-keyer',from:'uskfill:1:2',to:'processor',kind:'assigned',traceable:true},
 {id:'unrelated-preview',from:'camera-1',to:'me-2-preview'},
 {id:'cross-branch',from:'bus-a',to:'processor'}
],adjacency:{outgoing:new Map(),incoming:new Map()}};
for(const edge of traceGraph.edges){
 if(!traceGraph.adjacency.outgoing.has(edge.from))traceGraph.adjacency.outgoing.set(edge.from,new Set());
 traceGraph.adjacency.outgoing.get(edge.from).add(edge.to);
 if(!traceGraph.adjacency.incoming.has(edge.to))traceGraph.adjacency.incoming.set(edge.to,new Set());
 traceGraph.adjacency.incoming.get(edge.to).add(edge.from);
}
const trace=explorer.explorerTrace(traceGraph,'selected');
assert.deepEqual([...trace.nodes].sort(),['bus-a','output','processor','selected','source-a'].sort(),'A selected node should trace its connected upstream and downstream signal path');
assert.deepEqual([...trace.edges].sort(),['bus-a','processor-output','selected-pgm','source-a'].sort(),'A trace should exclude neighboring and cross-branch edges');
assert.ok(!trace.edges.has('unrelated-preview'),'A selected media-player key route must not light an unrelated camera-to-preview line');
assert.ok(!trace.edges.has('cross-branch'),'A trace must not include a shortcut that bypasses the inspected node');
assert.ok(!trace.edges.has('inactive-assignment'),'Inactive keyer assignments must not light up as part of an on-air source trace');
const sourceTrace=explorer.explorerTrace(traceGraph,'source-a');
assert.ok(sourceTrace.edges.has('active-assignment')&&sourceTrace.edges.has('active-keyer'),'An on-air keyer contribution should remain connected to its selected source');
assert.ok(!sourceTrace.edges.has('inactive-assignment'),'An inactive keyer assignment must stay dim while tracing its source');
const assignmentTrace=explorer.explorerTrace(traceGraph,'uskfill:1:1');
assert.ok(assignmentTrace.edges.has('inactive-assignment'),'Selecting a keyer fill directly should still reveal its configured assignment');

const inputs=Array.from({length:110},(_,i)=>({id:i+1,name:'Input '+(i+1)}));
const mixEffects=Array.from({length:4},(_,i)=>({
 index:i+1,pgmId:i+1,pvwId:i+5,
 upstreamKeyers:Array.from({length:4},(_,key)=>({index:key+1,onAir:key===0,fillId:20+i*8+key*2,keyId:21+i*8+key*2}))
}));
const downstreamKeyers=Array.from({length:4},(_,i)=>({index:i+1,fillId:60+i*2,keyId:61+i*2}));
const routing=Array.from({length:24},(_,i)=>({busId:i+1,sourceId:(i*7)%inputs.length+1,name:'Output '+(i+1)}));
context.liveEngineering={inputs,mixEffects,downstreamKeyers,routing};

const began=performance.now();
const graph=explorer.explorerBuildGraph();
const svg=explorer.explorerDraw(graph);
const elapsed=performance.now()-began;
const liveKeyTrace=explorer.explorerTrace(graph,'src:20'),idleKeyTrace=explorer.explorerTrace(graph,'src:22');
assert.ok(liveKeyTrace.edges.has('src:20->uskfill:1:1')&&liveKeyTrace.edges.has('uskfill:1:1->me:1'),'A selected source used by an on-air keyer should highlight the complete route into its M/E');
assert.ok(!idleKeyTrace.edges.has('src:22->uskfill:1:2'),'A selected source assigned only to an off-air keyer must not highlight that unrelated assignment');
const nodeIds=new Set(graph.nodes.map(node=>node.id));
assert.ok(graph.nodes.length>150&&graph.edges.length>70,'Representative ATEM state should produce a substantial graph');
assert.ok(graph.edges.every(edge=>nodeIds.has(edge.from)&&nodeIds.has(edge.to)),'Every route should connect existing graph nodes');
assert.equal(new Set(graph.edges.map(edge=>edge.id)).size,graph.edges.length,'Every route should have a unique trace identity');
assert.ok(explorer.explorerReach(graph,graph.nodes[0].id).size>0,'Indexed traversal should include its starting node');
assert.ok(graph.edges.every(edge=>!explorer.explorerReach(graph,edge.to).has(edge.from)),'Cycle filtering should keep the overview graph acyclic');
assert.match(svg,/aria-label="Live ATEM signal overview"/,'Signal Explorer should still produce its accessible SVG');
assert.equal((svg.match(/class="overviewEdge /g)||[]).length,graph.edges.length,'Every route should be drawn exactly once');
assert.match(styles,/\.signalOverview\.is-filtered \.overviewEdge:not\(\.is-active\)\{opacity:\.015\}/,'A trace must visually suppress every edge outside the selected route');
assert.match(styles,/\.signalOverview\.is-filtered \.overviewDirection:not\(\.is-active\)\{opacity:0\}/,'Direction markers outside the selected route must stay hidden');
assert.match(app,/const firstXs=sample\(xs,11\)/,'Signal Explorer must retain the stable wide fan-out channel layout');
assert.match(app,/const overflowYs=ys\.filter\(y=>y>=bounds\.nodeBottom\+22\)/,'Long routes must retain dedicated overflow lanes instead of crowding node rows');
console.log(`Signal Explorer graph/render regression passed (${graph.nodes.length} nodes, ${graph.edges.length} routes, ${elapsed.toFixed(1)} ms)`);
