'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('public/app.js','utf8');
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
assert.equal(focus.explorerFocusId(),'Media Player 3 Key','A pinned route must remain the only highlighted trace while the pointer crosses unrelated nodes');
focus.explorerInspect('Media Player 3 Key',true);
focus.explorerInspect('Camera 1',false);
assert.equal(focus.explorerFocusId(),'Camera 1','Hover inspection should resume after the pinned route is toggled off');

const traceGraph={edges:[
 {id:'source-a',from:'source-a',to:'bus-a'},
 {id:'bus-a',from:'bus-a',to:'selected'},
 {id:'selected-pgm',from:'selected',to:'processor'},
 {id:'processor-output',from:'processor',to:'output'},
 {id:'branch',from:'source-b',to:'other-bus'},
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

const inputs=Array.from({length:110},(_,i)=>({id:i+1,name:'Input '+(i+1)}));
const mixEffects=Array.from({length:4},(_,i)=>({
 index:i+1,pgmId:i+1,pvwId:i+5,
 upstreamKeyers:Array.from({length:4},(_,key)=>({index:key+1,fillId:20+i*8+key*2,keyId:21+i*8+key*2}))
}));
const downstreamKeyers=Array.from({length:4},(_,i)=>({index:i+1,fillId:60+i*2,keyId:61+i*2}));
const routing=Array.from({length:24},(_,i)=>({busId:i+1,sourceId:(i*7)%inputs.length+1,name:'Output '+(i+1)}));
context.liveEngineering={inputs,mixEffects,downstreamKeyers,routing};

const began=performance.now();
const graph=explorer.explorerBuildGraph();
const svg=explorer.explorerDraw(graph);
const elapsed=performance.now()-began;
const nodeIds=new Set(graph.nodes.map(node=>node.id));
assert.ok(graph.nodes.length>150&&graph.edges.length>70,'Representative ATEM state should produce a substantial graph');
assert.ok(graph.edges.every(edge=>nodeIds.has(edge.from)&&nodeIds.has(edge.to)),'Every route should connect existing graph nodes');
assert.equal(new Set(graph.edges.map(edge=>edge.id)).size,graph.edges.length,'Every route should have a unique trace identity');
assert.ok(explorer.explorerReach(graph,graph.nodes[0].id).size>0,'Indexed traversal should include its starting node');
assert.ok(graph.edges.every(edge=>!explorer.explorerReach(graph,edge.to).has(edge.from)),'Cycle filtering should keep the overview graph acyclic');
assert.match(svg,/aria-label="Live ATEM signal overview"/,'Signal Explorer should still produce its accessible SVG');
assert.equal((svg.match(/class="overviewEdge /g)||[]).length,graph.edges.length,'Every route should be drawn exactly once');
console.log(`Signal Explorer graph/render regression passed (${graph.nodes.length} nodes, ${graph.edges.length} routes, ${elapsed.toFixed(1)} ms)`);
