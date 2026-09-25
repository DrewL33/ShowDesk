


let connectedDevice=null;
let pgm="—",pvw="—",pgmSince=Date.now(),pvwSince=Date.now(),lastChangeText="—";
const baselineState={attached:false,name:"",loadedAt:null,routes:{},pgm:null,pvw:null,metadata:{}};
const liveState={routes:{},pgm:"—",pvw:"—",updatedAt:null};
let expected=baselineState.routes,actual=liveState.routes,saved={},logs=[],sessionEvents=[];
let selectedDestination=null;
let selectedMeIndex=1;
const signalTreeOpen=new Set(["group:physical"]);
function rememberSignalTreeState(){document.querySelectorAll("#signalTree details[data-tree-key]").forEach(el=>{const k=el.dataset.treeKey;if(el.open)signalTreeOpen.add(k);else signalTreeOpen.delete(k)})}
const standard=[];
function $(id){return document.getElementById(id)}

let liveEngineering={inputs:[],mixEffects:[],downstreamKeyers:[],routing:[],productIdentifier:null,videoMode:null,topology:{},debug:null};
function toggleDebug(){const el=$("atemDebug");if(!el)return;el.hidden=!el.hidden;if(!el.hidden)renderDebug()}
function renderDebug(){const el=$("atemDebug");if(!el)return;el.textContent=JSON.stringify({productIdentifier:liveEngineering.productIdentifier,videoMode:liveEngineering.videoMode,topology:liveEngineering.topology,inputs:liveEngineering.inputs,mixEffects:liveEngineering.mixEffects,downstreamKeyers:liveEngineering.downstreamKeyers,auxRoutes:{...actual},rawExposedState:liveEngineering.debug},null,2)}
function toast(msg){let t=$("toast");if(!t)return;t.textContent=msg;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),1100)}
document.addEventListener("click",e=>{
 const b=e.target.closest("button");if(!b||b.disabled)return;
 b.classList.remove("clickFlash");void b.offsetWidth;b.classList.add("clickFlash");
 setTimeout(()=>b.classList.remove("clickFlash"),260);
});
function validIpLike(v){
 const parts=v.trim().split(".");
 return parts.length===4&&parts.every(x=>/^\d{1,3}$/.test(x)&&Number(x)>=0&&Number(x)<=255);
}
async function connectionInputChanged(){
 const ip=$("atemIp").value.trim();
 $("connectAtemBtn").disabled=!validIpLike(ip);
 $("setupStatus").textContent=validIpLike(ip)?"Ready to connect to ATEM at "+ip+".":"Enter a valid IPv4 address. ShowDesk will read the connected ATEM automatically.";
}
async function connectAtem(){
 const ip=$("atemIp").value.trim();
 window.__showDeskConnectInvoked=(window.__showDeskConnectInvoked||0)+1;
 if(!validIpLike(ip))return;
 const btn=$("connectAtemBtn"),status=$("setupStatus");
 btn.disabled=true;btn.textContent="DISCOVERING…";status.textContent="Contacting "+ip+" and reading switcher topology, inputs, outputs, M/Es, keyers and routing…";
 const transport=window.ATEM_TRANSPORT;
 status.dataset.phase="transport";
 if(!transport||typeof transport.connect!=="function"){
   setConnectionStatus("ATEM network transport is not installed. Connect the production ATEM transport service, then try again.",true);
   return;
 }
 let d;
 try{
   status.dataset.phase="request";
   d=await transport.connect(ip);
   status.dataset.phase="response";
 }catch(error){
   const message=error?.message||String(error);
   status.textContent="Unable to connect to ATEM at "+ip+". "+message;
   status.style.color="var(--amber)";
   btn.disabled=false;
   btn.textContent="TRY AGAIN";
   return;
 }
 if(!d){
   status.textContent="Unable to connect to ATEM at "+ip+".";
   status.style.color="var(--amber)";
   btn.disabled=false;
   btn.textContent="TRY AGAIN";
   return;
 }
 status.style.color="";
 connectedDevice=d;
 try{ applyAtemStateUpdate(d); }catch(error){ console.error("[ShowDesk initial render]",error); status.textContent="ATEM connected, but ShowDesk could not render switcher state. "+(error?.message||String(error)); status.style.color="var(--amber)"; btn.disabled=false; btn.textContent="TRY AGAIN"; return; }
 if(transport.subscribe){
   transport.subscribe((patch)=>window.ATEM_OPS?.applyStateUpdate?.(patch));
 }
   $("modelLabel").textContent=d.name+" • "+ip;
   $("setup").classList.add("hidden");
   btn.textContent="CONNECT TO ATEM";
   // Live ATEM state remains authoritative after discovery. Do not replace it
   // with demo/default routes. A Show Reference is managed separately.
   addLog("SYSTEM",d.name+" discovered at "+ip);render();

}
function selectME(index){selectedMeIndex=Number(index)||1;render()}
function selectedME(){return (liveEngineering.mixEffects||[]).find(me=>me.index===selectedMeIndex)||(liveEngineering.mixEffects||[])[0]||null}
function setTab(tab){toast(tab.toUpperCase()+" view");
 $("app").className="wrap tab-"+tab;
 $("showBtn").classList.toggle("on",tab==="show");$("signalBtn").classList.toggle("on",tab==="signal");$("engBtn").classList.toggle("on",tab==="engineering");
 if(tab==="signal")renderPaths();
}
function recordEvent(kind,msg,data={}){const e={iso:new Date().toISOString(),t:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}),kind,msg,data};sessionEvents.unshift(e);logs=sessionEvents;lastChangeText=msg;return e}
function addLog(kind,msg){recordEvent(kind,msg);renderLog()}
function renderLog(){let e=$("log");if(e)e.innerHTML=logs.slice(0,12).map(x=>`<div class="li"><span>${x.t}</span><b>${x.kind}</b><em>${x.msg}</em></div>`).join("")||`<div class="li"><em>No changes yet</em></div>`}
window.routeHistory=window.routeHistory||{};
function rememberRouteChange(n,next){
 const prev=actual[n];
 if(prev!==next)window.routeHistory[n]={from:prev,at:Date.now()};
 actual[n]=next;
}
function getMismatches(){
 if(!baselineState.attached)return [];
 const out=[];
 Object.entries(baselineState.routes||{}).forEach(([name,expectedRoute])=>{
   if(actual[name]!==undefined&&actual[name]!==expectedRoute)out.push({type:"ROUTE",name,expected:expectedRoute,actual:actual[name]});
 });
 if(baselineState.pgm&&pgm!==baselineState.pgm)out.push({type:"PROGRAM",name:"M/E 1 PROGRAM",expected:baselineState.pgm,actual:pgm});
 if(baselineState.pvw&&pvw!==baselineState.pvw)out.push({type:"PREVIEW",name:"M/E 1 PREVIEW",expected:baselineState.pvw,actual:pvw});
 return out;
}
function updateReferenceUI(){
 const on=baselineState.attached,name=baselineState.name||"Reference";
 if($("referenceStatus")){$("referenceStatus").hidden=!on;if(on)$("referenceName").textContent=name;}
 if($("referenceEmpty"))$("referenceEmpty").hidden=on;
 if($("referenceAttached"))$("referenceAttached").hidden=!on;
 if(on){if($("engReferenceName"))$("engReferenceName").textContent=name;if($("referenceMeta"))$("referenceMeta").textContent=`${Object.keys(baselineState.routes).length} comparable routes • loaded ${new Date(baselineState.loadedAt).toLocaleTimeString()}`;}
 if($("diagReference"))$("diagReference").textContent=on?name:"NONE";
 const mm=getMismatches();if($("mismatchCount"))$("mismatchCount").textContent=on?mm.length:"—";
 if($("sessionChangeCount"))$("sessionChangeCount").textContent=sessionEvents.filter(e=>["ROUTE","M/E 1","STATE"].includes(e.kind)).length;
 if($("logEventCount"))$("logEventCount").textContent=sessionEvents.length;
}
function normalizeReferenceObject(obj){
 const routes={};
 const candidate=obj.routes||obj.outputs||obj.aux||obj.routing||obj.baseline?.routes||obj.reference?.routes;
 if(Array.isArray(candidate))candidate.forEach((x,i)=>{if(x&&typeof x==="object")routes[x.name||x.label||standard[i]||`OUTPUT ${i+1}`]=x.route||x.source||x.value;});
 else if(candidate&&typeof candidate==="object")Object.entries(candidate).forEach(([k,v])=>routes[k]=typeof v==="object"?(v.route||v.source||v.value):v);
 Object.keys(routes).forEach(k=>{if(routes[k]===undefined||routes[k]===null)delete routes[k];else routes[k]=String(routes[k]);});
 return {routes,pgm:obj.pgm||obj.program||obj.baseline?.pgm||null,pvw:obj.pvw||obj.preview||obj.baseline?.pvw||null,metadata:obj.metadata||{}};
}
function parseXmlReference(text){
 const doc=new DOMParser().parseFromString(text,"application/xml");
 if(doc.querySelector("parsererror"))throw new Error("Invalid XML");
 const routes={};
 [...doc.querySelectorAll("output,aux,route,destination")].forEach((el,i)=>{const n=el.getAttribute("name")||el.getAttribute("label")||el.getAttribute("destination");const v=el.getAttribute("source")||el.getAttribute("route")||el.getAttribute("value");if(n&&v)routes[n]=v;});
 return {routes,pgm:null,pvw:null,metadata:{format:"XML"}};
}
const SHOWDESK_REFERENCE_STORAGE_KEY="showdesk.reference.v1";
function persistReference(){
 try{
   if(!baselineState.attached){localStorage.removeItem(SHOWDESK_REFERENCE_STORAGE_KEY);return;}
   localStorage.setItem(SHOWDESK_REFERENCE_STORAGE_KEY,JSON.stringify({
     version:1,name:baselineState.name,loadedAt:baselineState.loadedAt,
     pgm:baselineState.pgm,pvw:baselineState.pvw,
     metadata:baselineState.metadata||{},routes:{...baselineState.routes}
   }));
 }catch(err){console.warn("ShowDesk could not persist the reference locally.",err);}
}
function restorePersistedReference(){
 try{
   const raw=localStorage.getItem(SHOWDESK_REFERENCE_STORAGE_KEY);if(!raw)return false;
   const saved=JSON.parse(raw);
   if(!saved||saved.version!==1||!saved.name||!saved.routes||typeof saved.routes!=="object")throw new Error("Invalid saved reference");
   baselineState.attached=true;baselineState.name=saved.name;baselineState.loadedAt=saved.loadedAt||new Date().toISOString();
   baselineState.pgm=saved.pgm||null;baselineState.pvw=saved.pvw||null;baselineState.metadata=saved.metadata||{};
   Object.keys(baselineState.routes).forEach(k=>delete baselineState.routes[k]);Object.assign(baselineState.routes,saved.routes);
   recordEvent("REFERENCE",`Reference restored locally: ${saved.name}`,{routes:Object.keys(saved.routes).length});
   return true;
 }catch(err){
   console.warn("ShowDesk ignored an invalid locally saved reference.",err);
   try{localStorage.removeItem(SHOWDESK_REFERENCE_STORAGE_KEY);}catch(_){}
   return false;
 }
}
async function importReferenceFile(event){
 const file=event.target.files?.[0];if(!file)return;
 try{
   const text=await file.text();let ref;
   if(file.name.toLowerCase().endsWith(".json")){ref=normalizeReferenceObject(JSON.parse(text));}
   else {ref=parseXmlReference(text);}
   if(!Object.keys(ref.routes).length&&!ref.pgm&&!ref.pvw)throw new Error("No comparable routing or bus state was found in this file.");
   baselineState.attached=true;baselineState.name=file.name;baselineState.loadedAt=new Date().toISOString();baselineState.pgm=ref.pgm;baselineState.pvw=ref.pvw;baselineState.metadata=ref.metadata||{};
   Object.keys(baselineState.routes).forEach(k=>delete baselineState.routes[k]);Object.assign(baselineState.routes,ref.routes);
   recordEvent("REFERENCE",`Reference attached: ${file.name}`,{routes:Object.keys(ref.routes).length});persistReference();updateReferenceUI();render();toast("Reference attached");
 }catch(err){toast("Reference not imported");alert("ShowDesk could not use this reference file. "+err.message+"\n\nFor now, import JSON containing routes/outputs/aux, or XML with output/aux/route elements that identify a destination and source.");}
 event.target.value="";
}
function clearReference(){
 if(!baselineState.attached)return;const old=baselineState.name;baselineState.attached=false;baselineState.name="";baselineState.loadedAt=null;baselineState.pgm=null;baselineState.pvw=null;baselineState.metadata={};Object.keys(baselineState.routes).forEach(k=>delete baselineState.routes[k]);recordEvent("REFERENCE",`Reference removed: ${old}`);persistReference();updateReferenceUI();render();toast("Reference removed");
}
async function exportLogReport(){
 const mismatches=getMismatches();const report={product:"ShowDesk",exportedAt:new Date().toISOString(),device:connectedDevice?{name:connectedDevice.name,inputs:connectedDevice.inputs,outputs:connectedDevice.outputs,mes:connectedDevice.mes}:null,reference:baselineState.attached?{name:baselineState.name,loadedAt:baselineState.loadedAt,routes:baselineState.routes,pgm:baselineState.pgm,pvw:baselineState.pvw}:null,live:{pgm,pvw,routes:{...actual}},mismatches,history:sessionEvents};
 const text=JSON.stringify(report,null,2),blob=new Blob([text],{type:"application/json"}),filename=`ShowDesk Report ${new Date().toISOString().replace(/[:.]/g,"-")}.json`;
 try{
   if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:"ShowDesk log report",accept:{"application/json":[".json"]}}]});const writable=await handle.createWritable();await writable.write(blob);await writable.close();toast("Log report saved");}
   else {const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast("Log report exported");}
 }catch(err){if(err?.name!=="AbortError")toast("Export failed");}
}
function renderInputs(){
  const inputs=liveEngineering.inputs||[],me=selectedME(),selectedPgm=me?.pgm||"—",selectedPvw=me?.pvw||"—";
  $("inputGrid").innerHTML=inputs.map(x=>{const n=x.name||`SOURCE ${x.id}`,state=n===selectedPgm?"live":n===selectedPvw?"ready":"",id=Number(x.id),physical=id>0&&id<1000,label=physical?`INPUT ${id}`:(id===0?"INTERNAL SOURCE":"INTERNAL SOURCE");return `<div class="inputCard ${state}"><span class="inum">${label}</span><b>${n}</b></div>`}).join("");
  $("inputCountLabel").textContent=`${inputs.length} sources reported`;
}
function selectDestination(name){selectedDestination=name;renderPaths()}
function drawSignalConnectors(){
 document.querySelectorAll(".treeBranches").forEach(root=>{
  let svg=root.querySelector(":scope > .signalConnectors");
  if(!svg){svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("class","signalConnectors");root.prepend(svg)}
  const rr=root.getBoundingClientRect(),groups=[...root.querySelectorAll(".treeBranchGroup")];
  svg.setAttribute("viewBox",`0 0 ${Math.max(1,root.clientWidth)} ${Math.max(1,root.scrollHeight)}`);svg.innerHTML="";
  const path=d=>{const p=document.createElementNS("http://www.w3.org/2000/svg","path");p.setAttribute("d",d);svg.appendChild(p)};
  const top=groups.filter(g=>!g.dataset.parentBranch);
  if(top.length){const boxes=top.map(g=>g.querySelector(":scope > .treeBranch").getBoundingClientRect()),x=5,ys=boxes.map(b=>b.top-rr.top+b.height/2),trunkTop=Math.max(0,Math.min(...ys)-22);path(`M ${x} ${trunkTop} V ${Math.max(...ys)}`);boxes.forEach((b,i)=>path(`M ${x} ${ys[i]} H ${b.left-rr.left}`))}
  groups.filter(g=>g.dataset.parentBranch).forEach(g=>{const child=g.querySelector(":scope > .treeBranch"),parent=document.getElementById(g.dataset.parentBranch);if(!child||!parent)return;const p=parent.getBoundingClientRect(),b=child.getBoundingClientRect(),sx=p.left-rr.left+24,sy=p.bottom-rr.top,ey=b.top-rr.top+b.height/2,ex=b.left-rr.left;if(ey<sy)return;path(`M ${sx} ${sy} V ${ey} H ${ex}`)});
 });
}
let signalConnectorResizeBound=false;
function scheduleSignalConnectors(){requestAnimationFrame(()=>requestAnimationFrame(drawSignalConnectors));if(!signalConnectorResizeBound){window.addEventListener("resize",scheduleSignalConnectors);signalConnectorResizeBound=true}}
function renderPaths(){
 const d=connectedDevice;if(!d)return;
 rememberSignalTreeState();
 const inputs=liveEngineering.inputs||[],mes=liveEngineering.mixEffects||[],dsks=liveEngineering.downstreamKeyers||[],routing=liveEngineering.routing||[];
 const q=($("signalSearch")?.value||"").trim().toLowerCase();
 const byId=new Map(inputs.map(x=>[Number(x.id),x]));
 const descendants=window.ShowDeskSignalPaths.createSignalPathTracer({inputs,mixEffects:mes,downstreamKeyers:dsks,routing}).descendants;
 let branchSequence=0;
 const renderBranch=(b,depth=0,parentId="")=>{const id="signal-branch-"+(++branchSequence);return `<div class="treeBranchGroup" data-branch-group="${id}" data-parent-branch="${parentId}"><div class="treeBranch ${b.kind}" id="${id}"><small>${b.kind==="program"?"PROGRAM":b.kind==="preview"?"PREVIEW":b.kind==="route"?"ATEM ROUTING":"ASSIGNMENT / PROCESSING"}</small><b>${b.label}</b>${b.ftb&&(b.ftb.isFullyBlack||b.ftb.inTransition)?'<span class="branchFtb">FTB</span>':""}${b.sub?`<small>${b.sub}</small>`:""}</div>${b.children?.length?`<div class="treeNested">${b.children.map(x=>renderBranch(x,depth+1,id)).join("")}</div>`:""}</div>`};
 const classified=inputs.map(input=>{const name=input.name||("SOURCE "+input.id),physical=Number(input.internalPortType)===0&&Number(input.id)>0,branches=descendants(input.id);return {input,name,physical,branches}}).filter(x=>!q||[x.name,"input "+x.input.id,"source "+x.input.id,...x.branches.map(b=>b.label)].join(" ").toLowerCase().includes(q));
 const renderSource=x=>{const key="source:"+x.input.id,open=q||signalTreeOpen.has(key);return `<details class="treeSource" data-tree-key="${key}" ${open?"open":""}><summary><small>${x.physical?"ATEM INPUT "+x.input.id:"INTERNAL "+x.input.id}</small><b>${x.name}</b><em>${x.branches.length} path${x.branches.length===1?"":"s"}</em></summary><div class="treeBranches">${x.branches.length?x.branches.map(renderBranch).join(""):'<div class="treeBranch idlePath"><small>STATE</small><b>NO ACTIVE PATH</b><small>Signal path will appear when this source is in use.</small></div>'}</div></details>`};
 const physical=classified.filter(x=>x.physical),internal=classified.filter(x=>!x.physical),tree=$("signalTree");
 if(tree)tree.innerHTML=`<details class="treeGroup" data-tree-key="group:physical" ${signalTreeOpen.has("group:physical")||q?"open":""}><summary>PHYSICAL INPUTS <span>${physical.length}</span></summary><div class="treeGroupBody">${physical.map(renderSource).join("")||'<div class="emptyRoute">No matching physical inputs.</div>'}</div></details><details class="treeGroup" data-tree-key="group:internal" ${signalTreeOpen.has("group:internal")||q?"open":""}><summary>INTERNAL SOURCES <span>${internal.length}</span></summary><div class="treeGroupBody">${internal.map(renderSource).join("")||'<div class="emptyRoute">No matching internal sources.</div>'}</div></details>`;
 scheduleSignalConnectors();
 const topo=liveEngineering.topology||{};if($("flowSources"))$("flowSources").textContent=topo.reportedSources??inputs.length;if($("flowMes"))$("flowMes").textContent=mes.length;if($("flowDests"))$("flowDests").textContent=routing.length;if($("flowIssues"))$("flowIssues").textContent=baselineState.attached?getMismatches().length:"—";
}
function render(){
 const activeMe=selectedME(),displayPgm=activeMe?.pgm||pgm,displayPvw=activeMe?.pvw||pvw;
 if($("pgm"))$("pgm").textContent=displayPgm;if($("pvw"))$("pvw").textContent=displayPvw;
 const meSelector=$("meSelector");if(meSelector)meSelector.innerHTML=(liveEngineering.mixEffects||[]).map(me=>`<button class="tinyAction ${me.index===selectedMeIndex?"primaryAction":""}" onclick="selectME(${me.index})">M/E ${me.index}</button>`).join("");

 let total=Object.keys(actual).filter(n=>actual[n]!=="UNUSED").length;
 const changed=Object.keys(actual).filter(n=>window.routeHistory[n]&&window.routeHistory[n].from!==actual[n]);
 const mismatches=getMismatches(), mismatchNames=new Set(mismatches.filter(x=>x.type==="ROUTE").map(x=>x.name));
 const activeDestNames=Object.keys(actual).filter(n=>actual[n]!=="UNUSED");
 const unusedDestNames=Object.keys(actual).filter(n=>actual[n]==="UNUSED");
 const destEl=$("dest"); if(destEl) destEl.innerHTML=activeDestNames.map(n=>{
   const current=actual[n]||"—", hist=window.routeHistory[n], isChanged=hist&&hist.from!==current;
   const detail=current==="PROGRAM"?`M/E 1 • ${pgm}`:current==="PREVIEW"?`M/E 1 • ${pvw}`:"DIRECT ROUTE";
   let change=`CURRENT`;
   if(isChanged){const sec=Math.max(0,Math.floor((Date.now()-hist.at)/1000));const age=sec<60?`${sec}s ago`:`${Math.floor(sec/60)}m ago`;change=`← was ${hist.from}<br>${age}`;}
   const isMismatch=mismatchNames.has(n);if(isMismatch){const mm=mismatches.find(x=>x.name===n);change=`EXPECTED ${mm.expected}<br>ACTUAL ${mm.actual}`;}
   return `<div class="drow ${isMismatch?"mismatch":isChanged?"changed":"quiet"}"><b>${n}</b><div class="destRoute"><strong>${current}</strong><small>${detail}</small></div><div class="changeState">${change}</div></div>`;
 }).join("")+(unusedDestNames.length?`<button class="unusedDestSummary" onclick="setTab('signal')"><strong>${unusedDestNames.length} UNUSED OUTPUT${unusedDestNames.length===1?"":"S"}</strong><span>View in Signal Paths →</span></button>`:"");
 if(destEl) destEl.classList.toggle("manyDestinations",activeDestNames.length>8);
 $("healthTitle").textContent=mismatches.length?"REFERENCE MISMATCH":changed.length?"ROUTING CHANGES":"SYSTEM READY";
 $("healthDetail").textContent=mismatches.length?`${mismatches.length} live state item${mismatches.length===1?" differs":"s differ"} from the attached reference`:changed.length?`${changed.length} destination route${changed.length>1?"s have":" has"} changed during this session`:`${total} destinations currently routed`;
 if($("routeMetric")) $("routeMetric").textContent=mismatches.length?`${mismatches.length} MISMATCH${mismatches.length===1?"":"ES"}`:`${total} ACTIVE`; if($("routeMetric")) $("routeMetric").className=mismatches.length?"bad":"ok";
 if($("engIssues")) $("engIssues").textContent=`${mismatches.length} mismatch${mismatches.length===1?"":"es"}`;
 if($("attention")) $("attention").innerHTML=(mismatches.length?mismatches.slice(0,5).map(x=>`<div class="attentionItem mismatch"><b>${x.name} MISMATCH</b><span>Expected ${x.expected} • Actual ${x.actual}</span></div>`).join(""):`<div class="attentionItem good"><b>${baselineState.attached?"REFERENCE MATCHES":"LIVE STATE STABLE"}</b><span>${baselineState.attached?"No defined reference expectations currently differ.":"Attach a show reference to enable expected-vs-actual verification."}</span></div>`)+(lastChangeText!=="—"?`<div class="attentionItem"><b>LAST CHANGE</b><span>${lastChangeText}</span></div>`:"");
 if($("lastChange"))$("lastChange").textContent=lastChangeText;
 renderInputs();
 const ig=$("inputGrid");
 if(ig){
   const cards=[...ig.children];
   const visibleLimit=24;
   if(cards.length>visibleLimit){
     cards.forEach((c,i)=>{if(i>=visibleLimit)c.style.display="none";});
     const more=document.createElement("div");
     more.className="input moreInputs";
     more.innerHTML=`<small>MORE INPUTS</small><b>+${cards.length-visibleLimit}</b><span>View in Signal Paths</span>`;
     more.onclick=()=>setTab("signal");
     ig.appendChild(more);
     if($("inputCountLabel"))$("inputCountLabel").textContent=`${visibleLimit} / ${cards.length} inputs shown`;
   }
 }
 renderPaths();renderEngineering();renderLog();updateReferenceUI()
}
setInterval(()=>{let s=Math.floor((Date.now()-pgmSince)/1000),q=Math.floor((Date.now()-pvwSince)/1000);if($("pgmTime"))$("pgmTime").textContent=`LIVE ${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;if($("pvwTime"))$("pvwTime").textContent=`READY ${String(Math.floor(q/60)).padStart(2,"0")}:${String(q%60).padStart(2,"0")}`;if($("clock"))$("clock").textContent=new Date().toLocaleTimeString()},1000);

function formatVideoMode(mode){
 const modes={0:["525i59.94","59.94i"],1:["625i50","50i"],2:["525i59.94 16:9","59.94i"],3:["625i50 16:9","50i"],4:["720p50","50 fps"],5:["720p59.94","59.94 fps"],6:["1080i50","50i"],7:["1080i59.94","59.94i"],8:["1080p23.98","23.98 fps"],9:["1080p24","24 fps"],10:["1080p25","25 fps"],11:["1080p29.97","29.97 fps"],12:["1080p50","50 fps"],13:["1080p59.94","59.94 fps"],14:["2160p23.98","23.98 fps"],15:["2160p24","24 fps"],16:["2160p25","25 fps"],17:["2160p29.97","29.97 fps"],18:["2160p50","50 fps"],19:["2160p59.94","59.94 fps"],20:["4320p23.98","23.98 fps"],21:["4320p24","24 fps"],22:["4320p25","25 fps"],23:["4320p29.97","29.97 fps"],24:["4320p50","50 fps"],25:["4320p59.94","59.94 fps"],26:["1080p30","30 fps"],27:["1080p60","60 fps"]};return modes[Number(mode)]||[mode??"—","—"];
}
function renderEngineering(){
 const e=liveEngineering,inputs=e.inputs||[],mes=e.mixEffects||[],dsks=e.downstreamKeyers||[];
 const keys=[];mes.forEach(me=>(me.upstreamKeyers||[]).forEach(k=>keys.push({...k,label:`USK ${k.index} · M/E ${me.index}`})));dsks.forEach(k=>keys.push({...k,label:`DSK ${k.index}`}));
 if($("showKeyers")){const ftbs=mes.map(me=>({index:me.index,state:me.ftb?(me.ftb.isFullyBlack?"BLACK":me.ftb.inTransition?"TRANSITION":"OFF"):"—"}));$("showKeyers").innerHTML=keys.map(k=>`<div class="key ${k.onAir?"on":""}">${k.label} • ${k.onAir?"ON AIR":"OFF"}</div>`).join("")+ftbs.map(f=>`<div class="key ${f.state==="BLACK"||f.state==="TRANSITION"?"on ftbLive":""}">FTB · M/E ${f.index} • ${f.state}</div>`).join("")}
 const selected=selectedME();
 if($("pgmContext"))$("pgmContext").textContent=selected?`M/E ${selected.index} • PROGRAM`:"—";
 if($("pvwContext"))$("pvwContext").textContent=selected?`M/E ${selected.index} • PREVIEW`:"—";
 const mx=$("routingMatrix");if(mx){const heads=['SOURCE',...mes.flatMap(me=>[`M/E${me.index} PGM`,`M/E${me.index} PVW`]),'KEYERS','OUTPUTS'];let h=heads.map(x=>`<div class="mc mh">${x}</div>`).join('');for(const input of inputs){const ku=keys.filter(k=>k.fill===input.name||k.key===input.name).map(k=>k.label);const outs=(e.routing||[]).filter(r=>(r.route||r.source||r.value)===input.name).map(r=>r.name||r.label||(`ATEM ROUTING BUS ${r.busId??r.protocolBusId??r.rawIndex??'—'}`));h+=`<div class="mc">${input.name}</div>`+mes.flatMap(me=>[`<div class="mc ${me.pgm===input.name?'mon':''}">${me.pgm===input.name?'● LIVE':'—'}</div>`,`<div class="mc ${me.pvw===input.name?'mpv':''}">${me.pvw===input.name?'● READY':'—'}</div>`]).join('')+`<div class="mc">${ku.join(' / ')||'—'}</div><div class="mc">${outs.join(' / ')||'—'}</div>`;}const cols=`125px repeat(${Math.max(1,heads.length-1)},88px)`;mx.style.gridTemplateColumns=cols;mx.innerHTML=h||'<div class="emptyRoute">No routing state received.</div>';}
 if($("meBusDetail"))$("meBusDetail").innerHTML=mes.map(me=>`<div class="busrow"><div class="lab">M/E ${me.index}</div><div class="bus"><span>PROGRAM</span><b>${me.pgm}</b></div><div class="bus"><span>PREVIEW</span><b>${me.pvw}</b></div><div class="bus ${me.ftb&&(me.ftb.isFullyBlack||me.ftb.inTransition)?'ftbLive':''}"><span>FTB</span><b>${me.ftb?(me.ftb.isFullyBlack?'BLACK':me.ftb.inTransition?'TRANSITION':'OFF'):'—'}</b></div></div>`).join('')||'<div class="emptyRoute">No M/E state received.</div>';
 if($("keyerInspector"))$("keyerInspector").innerHTML=keys.map(k=>`<div class="ins"><span>${k.label}</span><b class="${k.onAir?'ok':''}">${k.onAir?'ON AIR':'OFF'}</b><small>Fill: ${k.fill||'—'} · Key: ${k.key||'—'}</small></div>`).join('')||'<div class="emptyRoute">No keyer state received.</div>';
 renderDebug();
 if($("diagnostics")){const vm=formatVideoMode(e.videoMode),activeFtb=mes.filter(me=>me.ftb&&(me.ftb.isFullyBlack||me.ftb.inTransition)).map(me=>`M/E ${me.index}`).join(", ")||"NONE";$("diagnostics").innerHTML=`<div class="metric"><span>LINK</span><b class="ok">CONNECTED</b></div><div class="metric"><span>VIDEO MODE</span><b>${vm[0]}</b></div><div class="metric"><span>FRAME RATE</span><b>${vm[1]}</b></div><div class="metric"><span>MODEL</span><b>${e.productIdentifier||connectedDevice?.name||"—"}</b></div><div class="metric"><span>M/E BLOCKS</span><b>${mes.length}</b></div><div class="metric"><span>SOURCES REPORTED</span><b>${inputs.length}</b></div><div class="metric"><span>ROUTING DESTINATIONS</span><b>${(e.routing||[]).length}</b></div><div class="metric ${activeFtb!=="NONE"?"ftbLive":""}"><span>FTB ACTIVE</span><b>${activeFtb}</b></div><div class="metric"><span>REFERENCE</span><b id="diagReference">${baselineState.attached?baselineState.name:"NONE"}</b></div>`}
}
function applyAtemStateUpdate(patch={}){
   if(Array.isArray(patch.inputs)) liveEngineering.inputs=patch.inputs;
   if(Array.isArray(patch.mixEffects)) liveEngineering.mixEffects=patch.mixEffects;
   if(Array.isArray(patch.downstreamKeyers)) liveEngineering.downstreamKeyers=patch.downstreamKeyers;
   if(Array.isArray(patch.aux)) liveEngineering.routing=patch.aux;
   if(patch.productIdentifier!==undefined) liveEngineering.productIdentifier=patch.productIdentifier;
   if(patch.videoMode!==undefined) liveEngineering.videoMode=patch.videoMode;
   if(patch.topology!==undefined) liveEngineering.topology=patch.topology||{};
   if(patch.debug!==undefined) liveEngineering.debug=patch.debug;

  if(patch.pgm!==undefined){const prevPgm=pgm;pgm=typeof patch.pgm==="object"?(patch.pgm.name||patch.pgm.label||String(patch.pgm.id||patch.pgm)):patch.pgm;pgmSince=Date.now();if(prevPgm!==pgm)recordEvent("STATE",`PROGRAM: ${prevPgm} → ${pgm}`,{from:prevPgm,to:pgm});}
  if(patch.pvw!==undefined){const prevPvw=pvw;pvw=typeof patch.pvw==="object"?(patch.pvw.name||patch.pvw.label||String(patch.pvw.id||patch.pvw)):patch.pvw;pvwSince=Date.now();if(prevPvw!==pvw)recordEvent("STATE",`PREVIEW: ${prevPvw} → ${pvw}`,{from:prevPvw,to:pvw});}
  liveState.pgm=pgm;liveState.pvw=pvw;liveState.updatedAt=new Date().toISOString();
  if(Array.isArray(patch.aux)){
    const next={};
    patch.aux.forEach((x,i)=>{
      const name=x.name||x.label||standard[i]||`AUX ${i+1}`;
      next[name]=x.route||x.source||x.value||"UNUSED";
    });
    const prev={...actual};
    Object.keys(actual).forEach(k=>delete actual[k]);
    Object.assign(actual,next);
    Object.keys(next).forEach(name=>{if(prev[name]!==undefined&&prev[name]!==next[name]) recordEvent("ROUTE",`${name}: ${prev[name]} → ${next[name]}`,{destination:name,from:prev[name],to:next[name]});});
  }
  if(Array.isArray(patch.inputs)&&connectedDevice) connectedDevice.inputs=patch.inputs.length;
  render();
  const root=document.querySelector(".signalPage");
  if(root){root.classList.remove("routePulse");void root.offsetWidth;root.classList.add("routePulse");}
}
window.ATEM_OPS=Object.assign(window.ATEM_OPS||{},{applyStateUpdate:applyAtemStateUpdate});


(function(){
 const sig=document.querySelector(".signalPage .head");
 if(sig && !sig.querySelector(".routeLive")){
   const live=document.createElement("span");
   live.className="routeLive"; live.textContent="ROUTING LIVE"; sig.appendChild(live);
 }
})();


restorePersistedReference();updateReferenceUI();
window.addEventListener("error",e=>{const s=$("setupStatus"),b=$("connectAtemBtn");if(s&&!$("setup").classList.contains("hidden")){s.textContent="ShowDesk browser error: "+(e.message||"Unknown error");s.style.color="var(--amber)";if(b){b.disabled=false;b.textContent="TRY AGAIN";}}});
