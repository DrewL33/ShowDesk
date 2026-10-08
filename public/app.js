


let connectedDevice=null;
let pgm="—",pvw="—",pgmSince=Date.now(),pvwSince=Date.now(),lastChangeText="—";
const baselineState={attached:false,name:"",loadedAt:null,routes:{},pgm:null,pvw:null,metadata:{}};
const liveState={routes:{},pgm:"—",pvw:"—",updatedAt:null};
let expected=baselineState.routes,actual=liveState.routes,saved={},logs=[],sessionEvents=[];
let selectedDestination=null;
let selectedMeIndex=1;
let previousMeState=new Map();
let committedMeState=new Map();
let viewerConnectionSubscription=null;
let hostConnectionSubscription=null;
let hostReconnectTimer=null;
let hostReconnectIp=null;
let hostReconnectInFlight=false;
let hostReconnecting=false;
let liveStateSubscription=null;
let healthSubscription=null;
let viewerCountSubscription=null;
let connectionHealthTimer=null;
let connectionStartedAt=null;
let lastHealthAt=null;
const CONNECTION_STALE_MS=12000;
let viewerConnectionContext=null;
let viewerConnectionAttempt=0;
let activeConnectionMode=null;
let intentionalDisconnect=false;
let viewerReconnecting=false;
const standard=[];
function $(id){return document.getElementById(id)}

let liveEngineering={inputs:[],mixEffects:[],downstreamKeyers:[],routing:[],productIdentifier:null,videoMode:null,topology:{},debug:null};
function toggleDebug(){const el=$("atemDebug");if(!el)return;el.hidden=!el.hidden;if(!el.hidden)renderDebug()}
function renderDebug(){const el=$("atemDebug");if(!el)return;el.textContent=JSON.stringify({productIdentifier:liveEngineering.productIdentifier,videoMode:liveEngineering.videoMode,topology:liveEngineering.topology,inputs:liveEngineering.inputs,mixEffects:liveEngineering.mixEffects,downstreamKeyers:liveEngineering.downstreamKeyers,auxRoutes:{...actual},rawExposedState:liveEngineering.debug},null,2)}
function toast(msg){let t=$("toast");if(!t)return;t.textContent=msg;t.classList.add("show");clearTimeout(window.__toast);window.__toast=setTimeout(()=>t.classList.remove("show"),1100)}
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&$("settingsModal")&&!$("settingsModal").hidden)closeShowDeskSettings()});
document.addEventListener("click",e=>{
 const b=e.target.closest("button");if(!b||b.disabled)return;
 b.classList.remove("clickFlash");void b.offsetWidth;b.classList.add("clickFlash");
 setTimeout(()=>b.classList.remove("clickFlash"),260);
});
function validIpLike(v){
 const parts=v.trim().split(".");
 return parts.length===4&&parts.every(x=>/^\d{1,3}$/.test(x)&&Number(x)>=0&&Number(x)<=255);
}
function chooseConnectionMode(mode){
 const choice=$("modeChoice"),host=$("hostSetup"),viewer=$("viewerSetup");
 choice.hidden=!!mode;host.hidden=mode!=="host";viewer.hidden=mode!=="viewer";
}
const SHOWDESK_CONNECTION_STORAGE_KEY="showdesk.connections.v1";
function loadRememberedConnections(){try{const saved=JSON.parse(localStorage.getItem(SHOWDESK_CONNECTION_STORAGE_KEY)||"{}");return {atemIp:validIpLike(saved.atemIp||"")?saved.atemIp:"",viewerHostIp:validIpLike(saved.viewerHostIp||"")?saved.viewerHostIp:""};}catch{return {atemIp:"",viewerHostIp:""};}}
function rememberSuccessfulConnection(kind,ip){if(!validIpLike(ip))return;try{const saved=loadRememberedConnections();saved[kind]=ip;localStorage.setItem(SHOWDESK_CONNECTION_STORAGE_KEY,JSON.stringify(saved));}catch(err){console.warn("ShowDesk could not remember the connection address locally.",err);}}
function restoreRememberedConnections(){const saved=loadRememberedConnections();if(saved.atemIp&&$("atemIp"))$("atemIp").value=saved.atemIp;if(saved.viewerHostIp&&$("viewerHostIp"))$("viewerHostIp").value=saved.viewerHostIp;connectionInputChanged();viewerInputChanged();}
function viewerInputChanged(){
 const ip=$("viewerHostIp").value.trim();
 $("connectViewerBtn").disabled=!validIpLike(ip);
 $("viewerStatus").textContent=validIpLike(ip)?"Ready to connect to ShowDesk Host at "+ip+".":"Enter a valid ShowDesk Host IPv4 address.";
}
function ensureLiveStateSubscription(transport){
  if(liveStateSubscription||!transport?.subscribe)return;
  liveStateSubscription=transport.subscribe((patch)=>{markConnectionActivity();window.ATEM_OPS?.applyStateUpdate?.(patch);});
}
function clearLiveStateSubscription(){
  if(liveStateSubscription){liveStateSubscription();liveStateSubscription=null;}
}
function ensureViewerConnectionSubscription(transport){
 if(viewerConnectionSubscription||!transport?.subscribeConnection)return;
 viewerConnectionSubscription=transport.subscribeConnection(message=>{
   const ctx=viewerConnectionContext;if(!ctx)return;
   const {ip,btn,status,attempt}=ctx;if(attempt!==viewerConnectionAttempt)return;
   if(message.status==="viewer-connected"&&message.data){
     enterViewerConnection(message.data,ctx);
   }else if(message.status==="waiting"){
     status.textContent="ShowDesk Host reached at "+ip+". "+(message.reason||"Waiting for the Host to connect to an ATEM…");
     status.style.color="var(--amber)";btn.disabled=true;btn.textContent="WAITING FOR ATEM…";
   }else if(message.status==="reconnecting"&&!intentionalDisconnect){
     if(!viewerReconnecting)addLog("SYSTEM","Viewer reconnecting to ShowDesk Host at "+ip);
     viewerReconnecting=true;updateConnectionHealth();
   }else if(message.status==="viewer-connected"&&message.data){
     const wasReconnecting=viewerReconnecting;viewerReconnecting=false;enterViewerConnection(message.data,ctx);
     if(wasReconnecting)addLog("SYSTEM","Viewer reconnected to ShowDesk Host at "+ip);
   }
 });
}
function clearHostReconnectTimer(){if(hostReconnectTimer){clearTimeout(hostReconnectTimer);hostReconnectTimer=null;}}
function stopHostReconnect(){clearHostReconnectTimer();hostReconnectIp=null;hostReconnectInFlight=false;hostReconnecting=false;}
function ensureHostConnectionSubscription(transport){
 if(hostConnectionSubscription||!transport?.subscribeConnection)return;
 hostConnectionSubscription=transport.subscribeConnection(message=>{
  if(activeConnectionMode!=="host"||intentionalDisconnect||message?.status!=="disconnected")return;
  const ip=connectedDevice?.ip||hostReconnectIp;if(!ip)return;
  hostReconnectIp=ip;hostReconnecting=true;stopConnectionHealth();updateConnectionControls();refreshShowDeskSettings();
  addLog("SYSTEM","ATEM connection lost at "+ip+". Reconnecting…");
  scheduleHostReconnect(transport);
 });
}
function scheduleHostReconnect(transport){
 if(intentionalDisconnect||activeConnectionMode!=="host"||!hostReconnectIp||hostReconnectTimer||hostReconnectInFlight)return;
 hostReconnectTimer=setTimeout(()=>{hostReconnectTimer=null;attemptHostReconnect(transport);},2000);
}
async function attemptHostReconnect(transport){
 if(intentionalDisconnect||activeConnectionMode!=="host"||!hostReconnectIp||hostReconnectInFlight)return;
 const ip=hostReconnectIp;hostReconnectInFlight=true;
 try{
  const d=await transport.connect(ip);
  if(intentionalDisconnect||activeConnectionMode!=="host"||hostReconnectIp!==ip)return;
  connectedDevice=d;connectedDevice.ip=ip;applyAtemStateUpdate(d);hostReconnecting=false;hostReconnectIp=null;
  startConnectionHealth(transport);$("modelLabel").textContent=(d.name||d.productIdentifier||"ATEM Switcher")+" • "+ip;updateConnectionControls();refreshShowDeskSettings();
  addLog("SYSTEM","ATEM reconnected at "+ip);render();
 }catch(error){
  if(!intentionalDisconnect&&activeConnectionMode==="host"&&hostReconnectIp===ip)scheduleHostReconnect(transport);
 }finally{hostReconnectInFlight=false;if(hostReconnecting&&!hostReconnectTimer)scheduleHostReconnect(transport);}
}
function enterViewerConnection(d,ctx=viewerConnectionContext){
 if(!d||!ctx||ctx.attempt!==viewerConnectionAttempt)return;
 const {ip}=ctx;connectedDevice=d;connectedDevice.ip=ip;activeConnectionMode="viewer";intentionalDisconnect=false;viewerReconnecting=false;rememberSuccessfulConnection("viewerHostIp",ip);
 ensureLiveStateSubscription(window.ATEM_TRANSPORT);
 startConnectionHealth(window.ATEM_TRANSPORT);
 applyAtemStateUpdate(d);$("modelLabel").textContent=(d.name||d.productIdentifier||"ATEM Switcher")+" • "+ip;updateConnectionControls();$("setup").classList.add("hidden");addLog("SYSTEM","Viewer connected to ShowDesk Host at "+ip);render();
}
async function connectViewer(){
 const ip=$("viewerHostIp").value.trim(),btn=$("connectViewerBtn"),status=$("viewerStatus"),transport=window.ATEM_TRANSPORT;
 if(!validIpLike(ip)||!transport?.connectViewer)return;
 const attempt=++viewerConnectionAttempt;viewerConnectionContext={ip,btn,status,attempt};ensureViewerConnectionSubscription(transport);
 btn.disabled=true;btn.textContent="CONNECTING…";status.style.color="";status.textContent="Starting ShowDesk Viewer service…";
 try{
   status.textContent="Contacting ShowDesk Host at "+ip+" on port 47822…";
   const result=await transport.connectViewer(ip);if(attempt!==viewerConnectionAttempt)return;
   status.textContent="Host found — opening Viewer connection…";
   if(result?.status==="waiting"){status.textContent="ShowDesk Host reached at "+ip+". "+(result.reason||"Waiting for the Host to connect to an ATEM…");status.style.color="var(--amber)";btn.disabled=true;btn.textContent="WAITING FOR ATEM…";return;}
   enterViewerConnection(result?.data||result,viewerConnectionContext);
 }catch(error){
   if(attempt!==viewerConnectionAttempt)return;
   status.textContent=(error?.message||String(error));status.style.color="var(--amber)";btn.disabled=false;btn.textContent="TRY AGAIN";
 }
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
 connectedDevice=d;connectedDevice.ip=ip;activeConnectionMode="host";intentionalDisconnect=false;
 try{ applyAtemStateUpdate(d); }catch(error){ console.error("[ShowDesk initial render]",error); status.textContent="ATEM connected, but ShowDesk could not render switcher state. "+(error?.message||String(error)); status.style.color="var(--amber)"; btn.disabled=false; btn.textContent="TRY AGAIN"; return; }
 rememberSuccessfulConnection("atemIp",ip);
 ensureLiveStateSubscription(transport);
 ensureViewerCountSubscription(transport);
 ensureHostConnectionSubscription(transport);
 stopHostReconnect();
 startConnectionHealth(transport);
   $("modelLabel").textContent=d.name+" • "+ip;
   updateConnectionControls();
   $("setup").classList.add("hidden");
   btn.textContent="CONNECT TO ATEM";
   // Live ATEM state remains authoritative after discovery. Do not replace it
   // with demo/default routes. A Show Reference is managed separately.
   addLog("SYSTEM",d.name+" discovered at "+ip);render();

}
function formatConnectionAge(ms){const seconds=Math.max(0,Math.floor(ms/1000));if(seconds<60)return seconds+"s";const minutes=Math.floor(seconds/60);if(minutes<60)return minutes+"m "+(seconds%60)+"s";return Math.floor(minutes/60)+"h "+(minutes%60)+"m"}
function markConnectionActivity(){lastHealthAt=Date.now();updateConnectionHealth();}
function updateConnectionHealth(){
 const connected=activeConnectionMode==="host"||activeConnectionMode==="viewer";
 const flag=$("connectionFlag"),text=$("connectionFlagText");if(!flag||!text)return;
 if(!connected){flag.title="";flag.classList.remove("reconnecting");return;}
 const reconnecting=activeConnectionMode==="viewer"?viewerReconnecting:activeConnectionMode==="host"?hostReconnecting:false;
 if(reconnecting){
  text.innerHTML=activeConnectionMode.toUpperCase()+' • RECONNECTING <span class="reconnectNetwork" aria-hidden="true"><span class="reconnectEndpoint"></span><span class="reconnectDots"><i></i><i></i><i></i></span><span class="reconnectEndpoint destination"></span></span>';
  flag.classList.add("reconnecting");
 }else{
  text.textContent=activeConnectionMode.toUpperCase()+" • CONNECTED";
  flag.classList.remove("reconnecting");
 }
 const now=Date.now(),target=connectedDevice?.ip||"—",age=connectionStartedAt?formatConnectionAge(now-connectionStartedAt):"—",last=lastHealthAt?formatConnectionAge(now-lastHealthAt)+" ago":"awaiting activity";
 flag.title=(activeConnectionMode==="host"?"ATEM":"ShowDesk Host")+" "+target+"\nConnected "+age+"\nLast activity "+last;
}
function startConnectionHealth(transport){
 if(healthSubscription){healthSubscription();healthSubscription=null;}if(connectionHealthTimer){clearInterval(connectionHealthTimer);connectionHealthTimer=null;}
 connectionStartedAt=Date.now();lastHealthAt=Date.now();
 if(transport?.subscribeHealth)healthSubscription=transport.subscribeHealth(message=>{if(message?.atemConnected===false)return;markConnectionActivity();});
 connectionHealthTimer=setInterval(updateConnectionHealth,1000);updateConnectionHealth();
}
function stopConnectionHealth(){if(healthSubscription){healthSubscription();healthSubscription=null;}if(connectionHealthTimer){clearInterval(connectionHealthTimer);connectionHealthTimer=null;}connectionStartedAt=null;lastHealthAt=null;}
function updateViewerCount(count=0){const el=$("viewerCount");if(!el)return;const show=activeConnectionMode==="host"&&count>0;el.hidden=!show;if(show)el.textContent=count+" "+(count===1?"VIEWER":"VIEWERS");}
function ensureViewerCountSubscription(transport){if(viewerCountSubscription||!transport?.subscribeViewerCount)return;viewerCountSubscription=transport.subscribeViewerCount(updateViewerCount);}
function clearViewerCountSubscription(){if(viewerCountSubscription){viewerCountSubscription();viewerCountSubscription=null;}updateViewerCount(0);}
function updateConnectionControls(){
 const connected=activeConnectionMode==="host"||activeConnectionMode==="viewer";
 const flag=$("connectionFlag"),button=$("disconnectBtn");
 if(flag)flag.hidden=!connected;if(button)button.hidden=!connected;
 updateConnectionHealth();
}
async function disconnectShowDesk(){
 const transport=window.ATEM_TRANSPORT;if(!activeConnectionMode||!transport)return;
 intentionalDisconnect=true;viewerReconnecting=false;stopHostReconnect();
 ++viewerConnectionAttempt;viewerConnectionContext=null;
 clearLiveStateSubscription();
 clearViewerCountSubscription();
 stopConnectionHealth();
 try{
   if(activeConnectionMode==="viewer"&&transport.disconnectViewer)await transport.disconnectViewer();
   else if(activeConnectionMode==="host"&&transport.disconnect)await transport.disconnect();
 }catch(error){intentionalDisconnect=false;alert("ShowDesk could not disconnect cleanly.\n\n"+(error?.message||String(error)));return;}
 addLog("SYSTEM",activeConnectionMode==="viewer"?"Disconnected from ShowDesk Host":"Disconnected from ATEM");
 activeConnectionMode=null;connectedDevice=null;previousMeState=new Map();committedMeState=new Map();liveEngineering={inputs:[],mixEffects:[],downstreamKeyers:[],routing:[],productIdentifier:null,videoMode:null,topology:{},debug:null};
 $("setup").classList.remove("hidden");chooseConnectionMode(null);$("modelLabel").textContent="";updateConnectionControls();$("connectAtemBtn").textContent="CONNECT & HOST";$("connectViewerBtn").textContent="CONNECT TO HOST";connectionInputChanged();viewerInputChanged();intentionalDisconnect=false;render();
}
window.addEventListener("showdesk-native-menu",event=>{if(event.detail==="disconnect")disconnectShowDesk();});
function selectME(index){selectedMeIndex=Number(index)||1;render()}
function selectedME(){return (liveEngineering.mixEffects||[]).find(me=>me.index===selectedMeIndex)||(liveEngineering.mixEffects||[])[0]||null}
function refreshShowDeskSettings(){
 const mode=activeConnectionMode==="host"?"HOST":activeConnectionMode==="viewer"?"VIEWER":"NOT CONNECTED";
 if($("settingsMode"))$("settingsMode").textContent=mode;
 if($("settingsConnection"))$("settingsConnection").textContent=activeConnectionMode?((viewerReconnecting||hostReconnecting)?"RECONNECTING":"CONNECTED"):"DISCONNECTED";
 if($("settingsDevice"))$("settingsDevice").textContent=connectedDevice?.name||connectedDevice?.productIdentifier||liveEngineering.productIdentifier||"—";
 if($("settingsAddress"))$("settingsAddress").textContent=connectedDevice?.ip||viewerConnectionContext?.ip||"—";
 if($("settingsDisconnect"))$("settingsDisconnect").disabled=!activeConnectionMode;
 if($("settingsVersion"))$("settingsVersion").textContent=showDeskUpdater.currentVersion||"0.1.65"; if($("settingsBuild"))$("settingsBuild").textContent=`Build${String((showDeskUpdater.currentVersion||"0.1.65").split(".").pop()).padStart(3,"0")} • ${showDeskUpdater.currentVersion||"0.1.65"}`;
}
function openShowDeskSettings(){refreshShowDeskSettings();$("settingsModal").hidden=false}
function closeShowDeskSettings(){if($("settingsModal"))$("settingsModal").hidden=true}
async function disconnectFromSettings(){closeShowDeskSettings();await disconnectShowDesk()}
function checkUpdatesFromSettings(){closeShowDeskSettings();checkForShowDeskUpdate(true)}
function setTab(tab){toast((tab==="engineering"?"INSPECT":tab.toUpperCase())+" view");
 $("app").className="wrap tab-"+tab;
 $("showBtn").classList.toggle("on",tab==="show");$("signalBtn").classList.toggle("on",tab==="signal");$("engBtn").classList.toggle("on",tab==="engineering");
 if(tab==="signal")renderPaths();
}
function recordEvent(kind,msg,data={}){const e={iso:new Date().toISOString(),t:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"}),kind,msg,data};sessionEvents.unshift(e);logs=sessionEvents;lastChangeText=msg;return e}
function addLog(kind,msg){recordEvent(kind,msg);renderLog()}
function renderLog(){let e=$("log");if(e)e.innerHTML=logs.slice(0,18).map(x=>`<div class="li"><span class="logTime">${x.t}</span><b class="logKind">${x.kind}</b><em class="logMessage">${x.msg}</em></div>`).join("")||`<div class="li emptyLog"><em>No changes yet</em></div>`}
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
 if($("sessionChangeCount"))$("sessionChangeCount").textContent=sessionEvents.filter(e=>e.kind==="ROUTE"||e.kind==="STATE"||/^M\/E \d+$/.test(e.kind)).length;
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
 const nativeParser=window.ShowDeskReferenceParser?.parseAtemSoftwareControlXml;
 if(/<Profile\b/i.test(text)){
   if(typeof nativeParser!=="function")throw new Error("ATEM reference parser is not available.");
   return nativeParser(text);
 }
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
 }catch(err){toast("Reference not imported");alert("ShowDesk could not use this reference file. "+err.message+"\n\nImport an ATEM Software Control XML profile, ShowDesk JSON reference, or compatible XML reference.");}
 event.target.value="";
}
function clearReference(){
 if(!baselineState.attached)return;const old=baselineState.name;baselineState.attached=false;baselineState.name="";baselineState.loadedAt=null;baselineState.pgm=null;baselineState.pvw=null;baselineState.metadata={};Object.keys(baselineState.routes).forEach(k=>delete baselineState.routes[k]);recordEvent("REFERENCE",`Reference removed: ${old}`);persistReference();updateReferenceUI();render();toast("Reference removed");
}
async function exportLogReport(){
 const mismatches=getMismatches(),mes=liveEngineering.mixEffects||[],dsks=liveEngineering.downstreamKeyers||[],routing=liveEngineering.routing||[];
 const line=(label,value)=>label.padEnd(24," ")+(value??"—");
 const rows=["SHOWDESK SESSION REPORT","=======================","",line("ShowDesk version","0.1.38"),line("Exported",new Date().toLocaleString()),line("ATEM",connectedDevice?.name||liveEngineering.productIdentifier||"Not connected"),line("ATEM IP",connectedDevice?.ip||"—"),line("Video mode",liveEngineering.videoMode||"—"),line("Reported sources",(liveEngineering.inputs||[]).length),line("M/E buses",mes.length),"","CURRENT M/E STATE","-----------------"];
 mes.forEach(me=>{rows.push(`M/E ${me.index}`,`  PROGRAM: ${me.pgm||"—"}`,`  PREVIEW: ${me.pvw||"—"}`,`  FTB: ${me.ftb?.isFullyBlack?"BLACK":me.ftb?.inTransition?"TRANSITION":"OFF"}`);(me.upstreamKeyers||[]).forEach((k,i)=>rows.push(`  USK ${i+1}: ${k.onAir?"ON AIR":"OFF"} | Fill: ${k.fill||"—"} | Key: ${k.key||"—"}`));});
 if(dsks.length){rows.push("","DOWNSTREAM KEYERS","-----------------");dsks.forEach((k,i)=>rows.push(`DSK ${i+1}: ${k.onAir?"ON AIR":"OFF"} | Fill: ${k.fill||"—"} | Key: ${k.key||"—"}`));}
 rows.push("","ROUTING / AUX ASSIGNMENTS","-------------------------");
 if(routing.length)routing.forEach((r,i)=>rows.push(`${r.name||r.label||"ROUTE "+(i+1)}: ${r.route||r.source||r.value||"UNUSED"}`));else Object.entries(actual).forEach(([name,route])=>rows.push(`${name}: ${route}`));
 rows.push("","SHOW REFERENCE","--------------");
 if(baselineState.attached){rows.push(line("Reference",baselineState.name),line("Loaded",baselineState.loadedAt?new Date(baselineState.loadedAt).toLocaleString():"—"),line("Comparable routes",Object.keys(baselineState.routes).length),line("Mismatches",mismatches.length));mismatches.forEach(m=>rows.push(`  ${m.type} | ${m.name} | Expected: ${m.expected} | Actual: ${m.actual}`));}else rows.push("No reference attached.");
 rows.push("","SESSION EVENT HISTORY","---------------------");
 if(sessionEvents.length)[...sessionEvents].reverse().forEach(e=>rows.push(`${new Date(e.iso).toLocaleString()} | ${String(e.kind).padEnd(10," ")} | ${e.msg}`));else rows.push("No changes recorded this session.");
 rows.push("","END OF REPORT");
 const text=rows.join("\n"),blob=new Blob([text],{type:"text/plain;charset=utf-8"}),filename=`ShowDesk Report ${new Date().toISOString().replace(/[:.]/g,"-")}.txt`;
 try{
   const invoke=window.__TAURI_INTERNALS__?.invoke;
   if(typeof invoke==="function"){const initialDirectory=localStorage.getItem("showdesk.logs.lastDirectory")||null;const result=await invoke("save_log_report",{filename,contents:text,initialDirectory});if(result?.saved){if(result.directory)localStorage.setItem("showdesk.logs.lastDirectory",result.directory);toast("Log report saved");}}
   else if(window.showSaveFilePicker){const handle=await window.showSaveFilePicker({suggestedName:filename,types:[{description:"ShowDesk session report",accept:{"text/plain":[".txt"]}}]});const writable=await handle.createWritable();await writable.write(blob);await writable.close();toast("Log report saved");}
   else {const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);toast("Log report exported");}
 }catch(err){if(err?.name!=="AbortError")toast("Export failed");}
}
function renderActiveSources(){
 const el=$("activeSourceGrid");if(!el)return;
 const e=liveEngineering,items=[],seen=new Set(),add=(name,role,tone="")=>{if(!name||name==="—")return;const key=role+"|"+name;if(seen.has(key))return;seen.add(key);items.push({name,role,tone})};
 (e.mixEffects||[]).forEach(me=>{add(me.pgm,`M/E ${me.index} • PROGRAM`,"live");add(me.pvw,`M/E ${me.index} • PREVIEW`,"ready");(me.upstreamKeyers||[]).filter(k=>k.onAir).forEach(k=>{add(k.fill,`USK ${k.index} • M/E ${me.index} FILL`,"live");add(k.key,`USK ${k.index} • M/E ${me.index} KEY`,"live")})});
 (e.downstreamKeyers||[]).filter(k=>k.onAir).forEach(k=>{add(k.fill,`DSK ${k.index} • FILL`,"live");add(k.key,`DSK ${k.index} • KEY`,"live")});
 (e.routing||[]).forEach(r=>add(r.route||r.source||r.value,r.name||r.label||"ACTIVE ROUTE",""));
 el.innerHTML=items.map(x=>`<div class="activeSource ${x.tone}"><span>${x.role}</span><b>${x.name}</b></div>`).join("")||'<div class="activeSource emptyActive"><span>ACTIVE SOURCES</span><b>Awaiting live switcher state</b></div>';
 if($("activeSourceCount"))$("activeSourceCount").textContent=`${items.length} active use${items.length===1?"":"s"}`;
}
function renderInputs(){
  const inputs=liveEngineering.inputs||[],me=selectedME(),selectedPgm=me?.pgm||"—",selectedPvw=me?.pvw||"—";
  $("inputGrid").innerHTML=inputs.map(x=>{const n=x.name||`SOURCE ${x.id}`,state=n===selectedPgm?"live":n===selectedPvw?"ready":"",id=Number(x.id),physical=id>0&&id<1000,label=physical?`INPUT ${id}`:(id===0?"INTERNAL SOURCE":"INTERNAL SOURCE");return `<div class="inputCard ${state}"><span class="inum">${label}</span><b>${n}</b></div>`}).join("");
  $("inputCountLabel").textContent=`${inputs.length} sources reported`;
}
function selectDestination(name){selectedDestination=name;renderPaths()}

// Signal Explorer: persistent, read-only live routing graph (Build071).
let explorerPinned=null,explorerHover=null,explorerGraph=null,explorerTopology="",explorerRouteState="";
const explorerEscape=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const explorerKey=v=>String(v).replace(/[^a-zA-Z0-9_-]/g,"_");
function explorerInspect(id,pin=false){
 if(pin)explorerPinned=explorerPinned===id?null:id;
 else explorerHover=id;
 explorerHighlight();
}
function explorerClear(){explorerPinned=null;explorerHover=null;explorerHighlight()}
function explorerReach(graph,id,reverse=false){
 const seen=new Set([id]),queue=[id],edges=graph.edges;
 while(queue.length){
  const current=queue.shift();
  for(const e of edges){
   const from=reverse?e.to:e.from,to=reverse?e.from:e.to;
   if(from===current&&!seen.has(to)){seen.add(to);queue.push(to)}
  }
 }
 return seen;
}
function explorerHighlight(){
 const graph=explorerGraph,svg=document.querySelector("#explorerCanvas .signalOverview");
 if(!graph||!svg)return;
 const id=explorerPinned||explorerHover;
 let active=null;
 if(id&&graph.nodes.some(n=>n.id===id)){
  const node=graph.nodes.find(n=>n.id===id);
  active=explorerReach(graph,id,node.type==="destination");
 }
 svg.classList.toggle("is-filtered",!!active);
 svg.querySelectorAll("[data-signal-node]").forEach(el=>el.classList.toggle("is-active",!active||active.has(el.getAttribute("data-signal-node"))));
 svg.querySelectorAll("[data-signal-edge]").forEach(el=>{
  const e=graph.edges.find(e=>e.id===el.getAttribute("data-signal-edge"));
  el.classList.toggle("is-active",!active||!!(e&&active.has(e.from)&&active.has(e.to)));
 });
 const details=$("explorerDetails");
 if(details){
  const node=graph.nodes.find(n=>n.id===id);
  details.innerHTML=node?'<h3>INSPECTING</h3><strong>'+explorerEscape(node.label)+'</strong><p>'+ (explorerPinned?"Pinned trace · click again to clear":"Hover trace · click to pin")+'</p><p>Reported routing only. Keyer assignments may be inactive.</p>':'<h3>LIVE OVERVIEW</h3><p>Hover a source or destination to trace its route. Click to pin; click again to clear.</p>';
 }
}
function explorerBuildGraph(){
 const inputs=liveEngineering.inputs||[],mes=liveEngineering.mixEffects||[],dsks=liveEngineering.downstreamKeyers||[],routing=liveEngineering.routing||[];
 const nodes=[],edges=[],byId=new Map();
 const add=(id,label,type,group)=>{if(!byId.has(id)){const n={id,label,type,group};byId.set(id,n);nodes.push(n)}return id};
 const source=id=>{
  const input=inputs.find(i=>Number(i.id)===Number(id));
  return add("src:"+id,input?.name||("Source "+id),"source","INPUTS");
 };
 inputs.forEach(i=>source(i.id));
 const outputMe=id=>{
  const input=inputs.find(i=>Number(i.id)===Number(id));
  if(!input)return null;
  const m=[input.shortName,input.name].filter(Boolean).join(" ").match(/(?:M\/?E|ME)\s*(\d+)\s*(?:PGM|PROGRAM)/i);
  return m?mes.find(me=>Number(me.index)===Number(m[1])):null;
 };
 const connect=(from,to,kind="selected")=>{
  const id=from+"->"+to;
  if(!edges.some(e=>e.id===id))edges.push({id,from,to,kind});
 };
 const feed=(sourceId,destinationId,kind)=>{
  if(sourceId===undefined||sourceId===null||!Number.isFinite(Number(sourceId)))return;
  const me=outputMe(sourceId);
  connect(me?"me:"+me.index:source(sourceId),destinationId,kind);
 };
 mes.forEach(me=>{
  const id=add("me:"+me.index,"M/E "+me.index+" · Program","processor","M/E");
  const pgm=add("pgm:"+me.index,"M/E "+me.index+" · PGM bus","destination","M/E");
  const pvw=add("pvw:"+me.index,"M/E "+me.index+" · Preview","destination","M/E");
  feed(me.pgmId,pgm,"program");
  feed(me.pvwId,pvw,"preview");
  connect(pgm,id,"program");
  (me.upstreamKeyers||[]).forEach(k=>{
   const fill=add("uskfill:"+me.index+":"+k.index,"M/E "+me.index+" · USK "+k.index+" Fill","destination","KEYERS");
   const key=add("uskkey:"+me.index+":"+k.index,"M/E "+me.index+" · USK "+k.index+" Key","destination","KEYERS");
   feed(k.fillId,fill,"assigned");feed(k.keyId,key,"assigned");
   // Assignments do not imply on-air contribution.
  });
 });
 dsks.forEach(k=>{
  const fill=add("dskfill:"+k.index,"DSK "+k.index+" · Fill","destination","DSK");
  const key=add("dskkey:"+k.index,"DSK "+k.index+" · Key","destination","DSK");
  feed(k.fillId,fill,"assigned");feed(k.keyId,key,"assigned");
 });
 routing.forEach((r,i)=>{
  const id=add("aux:"+(r.busId??r.protocolBusId??r.rawIndex??i),r.name||("ATEM Routing "+(i+1)),"destination","AUX / ROUTING");
  feed(r.sourceId,id,"routing");
 });
 return {nodes,edges};
}
function explorerDraw(graph){
 const W=158,H=35,ROW=48,COLS=[22,262,504],top=44;
 const buckets=[[],[],[]];
 graph.nodes.forEach(n=>buckets[n.type==="source"?0:n.type==="processor"?1:2].push(n));
 // Keep stable positions across live source switching; positions depend only on device topology.
 const pos=new Map(),labels=[];
 buckets.forEach((bucket,col)=>{
  let y=top,last="";
  bucket.forEach(n=>{
   if(n.group!==last){labels.push('<text class="overviewGroup" x="'+COLS[col]+'" y="'+(y+1)+'">'+explorerEscape(n.group)+'</text>');y+=23;last=n.group}
   pos.set(n.id,{x:COLS[col],y});
   y+=ROW;
  });
 });
 const height=Math.max(240,...Array.from(pos.values()).map(p=>p.y+H+18)),width=COLS[2]+W+24;
 const nodes=graph.nodes.map(n=>{
  const p=pos.get(n.id);
  return '<g class="overviewNode" data-signal-node="'+explorerEscape(n.id)+'" onmouseenter="explorerInspect(\''+explorerEscape(n.id)+'\')" onmouseleave="explorerInspect(null)" onclick="explorerInspect(\''+explorerEscape(n.id)+'\',true)"><rect x="'+p.x+'" y="'+p.y+'" width="'+W+'" height="'+H+'" rx="4"/><text x="'+(p.x+9)+'" y="'+(p.y+22)+'">'+explorerEscape(n.label)+'</text><title>'+explorerEscape(n.label)+'</title></g>';
 }).join("");
 const paths=graph.edges.map(e=>{
  const a=pos.get(e.from),b=pos.get(e.to);if(!a||!b)return "";
  const x1=a.x+W,y1=a.y+H/2,x2=b.x,y2=b.y+H/2;
  const mid=x1+(x2-x1)/2;
  const d=x2>x1?'M'+x1+' '+y1+' H'+mid+' V'+y2+' H'+x2:'M'+x1+' '+y1+' H'+(x1+18)+' V'+(y2-10)+' H'+(x2-18)+' V'+y2+' H'+x2;
  return '<path class="overviewEdge '+explorerEscape(e.kind)+'" data-signal-edge="'+explorerEscape(e.id)+'" d="'+d+'"/>';
 }).join("");
 return '<svg class="signalOverview" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" width="'+width+'" height="'+height+'" role="img" aria-label="Live read-only ATEM signal overview">'+paths+labels.join("")+nodes+'</svg>';
}
function renderPaths(){
 const graph=explorerBuildGraph(),canvas=$("explorerCanvas"),list=$("explorerList");
 if(!canvas)return;
 const topology=graph.nodes.map(n=>n.id+"|"+n.label+"|"+n.group).join(";"),routing=graph.edges.map(e=>e.id+"|"+e.kind).sort().join(";");
 const changed=topology!==explorerTopology||!canvas.querySelector(".signalOverview");
 explorerGraph=graph;
 if(changed){
  const scroller=canvas.querySelector(".explorerDiagramScroll"),x=scroller?.scrollLeft||0,y=scroller?.scrollTop||0;
  canvas.innerHTML='<div class="explorerDiagramScroll">'+explorerDraw(graph)+'</div>';
  canvas.firstElementChild.scrollLeft=x;canvas.firstElementChild.scrollTop=y;
  explorerTopology=topology;explorerRouteState=routing;
 }else if(routing!==explorerRouteState){
  // Keep SVG nodes mounted; only update the edges that actually changed.
  const svg=canvas.querySelector(".signalOverview"),old=new Map([...svg.querySelectorAll("[data-signal-edge]")].map(el=>[el.getAttribute("data-signal-edge"),el]));
  const replacement=document.createElement("div");replacement.innerHTML=explorerDraw(graph);
  const fresh=replacement.querySelector(".signalOverview");
  for(const el of fresh.querySelectorAll("[data-signal-edge]")){
   const id=el.getAttribute("data-signal-edge");
   if(!old.has(id)){el.classList.add("is-new");svg.insertBefore(el,svg.firstChild)}
   else old.delete(id);
  }
  old.forEach(el=>{el.classList.add("is-exiting");setTimeout(()=>el.remove(),180)});
  explorerRouteState=routing;
 }
 const q=($("signalSearch")?.value||"").trim().toLowerCase();
 const items=graph.nodes.filter(n=>(n.type==="source"||n.type==="destination")&&(!q||n.label.toLowerCase().includes(q)));
 const listState=items.map(n=>n.id+"|"+n.label).join(";");
 if(list&&list.dataset.state!==listState){
  list.innerHTML=items.map(n=>'<button type="button" class="explorerItem" onmouseenter="explorerInspect(\''+explorerEscape(n.id)+'\')" onmouseleave="explorerInspect(null)" onclick="explorerInspect(\''+explorerEscape(n.id)+'\',true)">'+explorerEscape(n.label)+'</button>').join("")||'<p class="explorerEmpty">No matching sources or destinations.</p>';
  list.dataset.state=listState;
 }
 const modes=$("explorerModes");if(modes)modes.innerHTML='<span class="overviewLiveLabel">● LIVE OVERVIEW · READ ONLY</span><button type="button" class="tinyAction" onclick="explorerClear()">CLEAR TRACE</button>';
 const title=$("explorerTitle");if(title)title.textContent="ATEM signal overview · hover to trace either direction";
 explorerHighlight();
}
function transitionPercent(position){const n=Number(position);if(!Number.isFinite(n))return null;return Math.max(0,Math.min(100,Math.round(n>100?n/100:n)))}
function renderTransitionStatus(){const active=(liveEngineering.mixEffects||[]).filter(me=>me.transition?.inTransition);let el=$("transitionStatus");if(!el){el=document.createElement("div");el.id="transitionStatus";el.className="transitionStatus";document.body.appendChild(el)}if(!active.length){el.hidden=true;el.innerHTML="";return}el.hidden=false;el.innerHTML=active.map(me=>{const p=transitionPercent(me.transition?.position);return `<span>M/E ${me.index} TRANSITION</span><b>${p===null?"IN PROGRESS":p+"%"}</b><i><em style="width:${p===null?0:p}%"></em></i>`}).join("")}
function render(){
 const activeMe=selectedME(),displayPgm=activeMe?.pgm||pgm,displayPvw=activeMe?.pvw||pvw;
 if($("pgm"))$("pgm").textContent=displayPgm;if($("pvw"))$("pvw").textContent=displayPvw;
 const meSelector=$("meSelector");if(meSelector)meSelector.innerHTML=(liveEngineering.mixEffects||[]).map(me=>`<button class="tinyAction meSelectBtn ${me.index===selectedMeIndex?"on":""}" onclick="selectME(${me.index})">M/E ${me.index}</button>`).join("");
 renderTransitionStatus();

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
 renderInputs();renderActiveSources();
 const ig=$("inputGrid");
 if(ig){
   const cards=[...ig.children];
   const visibleLimit=24;
   if(cards.length>visibleLimit){
     cards.forEach((c,i)=>{if(i>=visibleLimit)c.style.display="none";});
     const more=document.createElement("div");
     more.className="input moreInputs";
     more.innerHTML=`<small>MORE INPUTS</small><b>+${cards.length-visibleLimit}</b><span>Continue in Inspect</span>`;
     more.onclick=()=>setTab("engineering");
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
 if($("showKeyers")){const ftbs=mes.map(me=>({index:me.index,state:me.ftb?(me.ftb.inTransition?"TRANSITION":me.ftb.isFullyBlack?"BLACK":"OFF"):"—"}));$("showKeyers").innerHTML=keys.map(k=>`<div class="key ${k.onAir?"on":""}">${k.label} • ${k.onAir?"ON AIR":"OFF"}</div>`).join("")+ftbs.map(f=>`<div class="key ${f.state==="BLACK"||f.state==="TRANSITION"?"on ftbLive":""} ${f.state==="TRANSITION"?"ftbTransition":""}">FTB · M/E ${f.index} • ${f.state}</div>`).join("")}
 const selected=selectedME();
 if($("pgmContext"))$("pgmContext").textContent=selected?`M/E ${selected.index} • PROGRAM`:"—";
 if($("pvwContext"))$("pvwContext").textContent=selected?`M/E ${selected.index} • PREVIEW`:"—";
 const mx=$("routingMatrix");if(mx){const heads=['SOURCE',...mes.flatMap(me=>[`M/E${me.index} PGM`,`M/E${me.index} PVW`]),'KEYERS','OUTPUTS'];let h=heads.map((x,i)=>`<div class="mc mh ${i===0?'matrixSource':''}">${x}</div>`).join('');for(const input of inputs){const ku=keys.filter(k=>k.fill===input.name||k.key===input.name).map(k=>k.label);const outs=(e.routing||[]).filter(r=>(r.route||r.source||r.value)===input.name).map(r=>r.name||r.label||(`ATEM ROUTING BUS ${r.busId??r.protocolBusId??r.rawIndex??'—'}`));h+=`<div class="mc matrixSource">${input.name}</div>`+mes.flatMap(me=>[`<div class="mc ${me.pgm===input.name?'mon':''}">${me.pgm===input.name?'● LIVE':'—'}</div>`,`<div class="mc ${me.pvw===input.name?'mpv':''}">${me.pvw===input.name?'● READY':'—'}</div>`]).join('')+`<div class="mc">${ku.join(' / ')||'—'}</div><div class="mc">${outs.join(' / ')||'—'}</div>`;}const cols=`125px repeat(${Math.max(1,heads.length-1)},112px)`;mx.style.gridTemplateColumns=cols;mx.innerHTML=h||'<div class="emptyRoute">No routing state received.</div>';}
 if($("meBusDetail"))$("meBusDetail").innerHTML=mes.map(me=>`<div class="busrow"><div class="lab">M/E ${me.index}</div><div class="bus"><span>PROGRAM</span><b>${me.pgm}</b></div><div class="bus"><span>PREVIEW</span><b>${me.pvw}</b></div><div class="bus ${me.ftb&&(me.ftb.isFullyBlack||me.ftb.inTransition)?'ftbLive':''}"><span>FTB</span><b>${me.ftb?(me.ftb.inTransition?'TRANSITION':me.ftb.isFullyBlack?'BLACK':'OFF'):'—'}</b></div></div>`).join('')||'<div class="emptyRoute">No M/E state received.</div>';
 if($("keyerInspector"))$("keyerInspector").innerHTML=keys.map(k=>`<div class="ins"><span>${k.label}</span><b class="${k.onAir?'ok':''}">${k.onAir?'ON AIR':'OFF'}</b><small>Fill: ${k.fill||'—'} · Key: ${k.key||'—'}</small></div>`).join('')||'<div class="emptyRoute">No keyer state received.</div>';
 renderDebug();
 if($("diagnostics")){const vm=formatVideoMode(e.videoMode),activeFtb=mes.filter(me=>me.ftb&&(me.ftb.isFullyBlack||me.ftb.inTransition)).map(me=>`M/E ${me.index}`).join(", ")||"NONE";$("diagnostics").innerHTML=`<div class="metric"><span>LINK</span><b class="ok">CONNECTED</b></div><div class="metric"><span>VIDEO MODE</span><b>${vm[0]}</b></div><div class="metric"><span>FRAME RATE</span><b>${vm[1]}</b></div><div class="metric"><span>MODEL</span><b>${e.productIdentifier||connectedDevice?.name||"—"}</b></div><div class="metric"><span>M/E BLOCKS</span><b>${mes.length}</b></div><div class="metric"><span>SOURCES REPORTED</span><b>${inputs.length}</b></div><div class="metric"><span>ROUTING DESTINATIONS</span><b>${(e.routing||[]).length}</b></div><div class="metric ${activeFtb!=="NONE"?"ftbLive":""}"><span>FTB ACTIVE</span><b>${activeFtb}</b></div><div class="metric"><span>REFERENCE</span><b id="diagReference">${baselineState.attached?baselineState.name:"NONE"}</b></div>`}
}
function applyAtemStateUpdate(patch={}){
   if(Array.isArray(patch.inputs)) liveEngineering.inputs=patch.inputs;
   if(Array.isArray(patch.mixEffects)){
     const nextMeState=new Map(),displayMixEffects=[];
     patch.mixEffects.forEach(me=>{const index=Number(me.index)||1,transitioning=!!me.transition?.inTransition,committed=committedMeState.get(index),displayMe=transitioning&&committed?{...me,pgm:committed.pgm,pvw:committed.pvw}:{...me};
       if(!transitioning)committedMeState.set(index,{pgm:me.pgm||"—",pvw:me.pvw||"—"});
       const prev=previousMeState.get(index),next={pgm:displayMe.pgm||"—",pvw:displayMe.pvw||"—",ftb:displayMe.ftb?{isFullyBlack:!!displayMe.ftb.isFullyBlack,inTransition:!!displayMe.ftb.inTransition}:null,upstreamKeyers:(displayMe.upstreamKeyers||[]).map(k=>({index:Number(k.index)||1,onAir:!!k.onAir,fill:k.fill||"—",key:k.key||"—"}))};
       if(prev){if(prev.pgm!==next.pgm)recordEvent(`M/E ${index}`,`PROGRAM: ${prev.pgm} → ${next.pgm}`,{me:index,field:"program",from:prev.pgm,to:next.pgm});if(prev.pvw!==next.pvw)recordEvent(`M/E ${index}`,`PREVIEW: ${prev.pvw} → ${next.pvw}`,{me:index,field:"preview",from:prev.pvw,to:next.pvw});if(prev.ftb?.isFullyBlack!==next.ftb?.isFullyBlack)recordEvent(`M/E ${index}`,`FADE TO BLACK: ${next.ftb?.isFullyBlack?"BLACK":"OFF"}`,{me:index,field:"ftb"});next.upstreamKeyers.forEach(k=>{const pk=(prev.upstreamKeyers||[]).find(x=>x.index===k.index);if(!pk)return;if(pk.onAir!==k.onAir)recordEvent(`M/E ${index}`,`USK ${k.index}: ${k.onAir?"ON AIR":"OFF"}`,{me:index,keyer:k.index,field:"onAir"});if(pk.fill!==k.fill)recordEvent(`M/E ${index}`,`USK ${k.index} FILL: ${pk.fill} → ${k.fill}`,{me:index,keyer:k.index,field:"fill"});if(pk.key!==k.key)recordEvent(`M/E ${index}`,`USK ${k.index} KEY: ${pk.key} → ${k.key}`,{me:index,keyer:k.index,field:"key"});});}nextMeState.set(index,next);displayMixEffects.push(displayMe);});
     previousMeState=nextMeState;liveEngineering.mixEffects=displayMixEffects;
   }
   if(Array.isArray(patch.downstreamKeyers)) liveEngineering.downstreamKeyers=patch.downstreamKeyers;
   if(Array.isArray(patch.aux)) liveEngineering.routing=patch.aux;
   if(patch.productIdentifier!==undefined) liveEngineering.productIdentifier=patch.productIdentifier;
   if(patch.videoMode!==undefined) liveEngineering.videoMode=patch.videoMode;
   if(patch.topology!==undefined) liveEngineering.topology=patch.topology||{};
   if(patch.debug!==undefined) liveEngineering.debug=patch.debug;

  if(patch.pgm!==undefined){const prevPgm=pgm;pgm=typeof patch.pgm==="object"?(patch.pgm.name||patch.pgm.label||String(patch.pgm.id||patch.pgm)):patch.pgm;pgmSince=Date.now();}
  if(patch.pvw!==undefined){const prevPvw=pvw;pvw=typeof patch.pvw==="object"?(patch.pvw.name||patch.pvw.label||String(patch.pvw.id||patch.pvw)):patch.pvw;pvwSince=Date.now();}
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
  const root=document.querySelector(".signalPage"),transitionActive=(liveEngineering.mixEffects||[]).some(me=>me.transition?.inTransition);
  if(root&&!transitionActive){root.classList.remove("routePulse");void root.offsetWidth;root.classList.add("routePulse");}
}
window.ATEM_OPS=Object.assign(window.ATEM_OPS||{},{applyStateUpdate:applyAtemStateUpdate});


(function(){
 const sig=document.querySelector(".signalPage .head");
 if(sig && !sig.querySelector(".routeLive")){
   const live=document.createElement("span");
   live.className="routeLive"; live.textContent="ROUTING LIVE"; sig.appendChild(live);
 }
})();


restorePersistedReference();restoreRememberedConnections();updateReferenceUI();
window.addEventListener("error",e=>{const s=$("setupStatus"),b=$("connectAtemBtn");if(s&&!$("setup").classList.contains("hidden")){s.textContent="ShowDesk browser error: "+(e.message||"Unknown error");s.style.color="var(--amber)";if(b){b.disabled=false;b.textContent="TRY AGAIN";}}});


/* Native desktop updater. Browser builds ignore this path entirely.
   One frontend state machine owns startup checks, manual checks, downloads and retries. */
function tauriInvoke(){return window.__TAURI_INTERNALS__?.invoke||null}
function formatUpdateBytes(bytes){const n=Number(bytes)||0;if(n<1024)return n+" B";if(n<1048576)return (n/1024).toFixed(1)+" KB";return (n/1048576).toFixed(1)+" MB"}
const showDeskUpdater={phase:"idle",available:null,operation:null,currentVersion:null};
function updaterErrorText(error){return String(error?.message||error||"Unknown updater error").trim()}
function updaterFailureKind(error){const msg=updaterErrorText(error).toLowerCase();if(/restart|relaunch/.test(msg))return "restart";if(/signature|verify|verification|install/.test(msg))return "install";return "download"}
function showUpdaterFailure(kind,error){
 const detail=updaterErrorText(error),retry=kind==="check"?()=>checkForShowDeskUpdate(true):installShowDeskUpdate;
 if(kind==="check"){setUpdateModal({title:"Unable to check for updates",message:detail,primary:"TRY AGAIN",primaryAction:retry,closeLabel:"CANCEL"});return;}
 if(kind==="restart"){setUpdateModal({title:"Update installed",message:"ShowDesk couldn't restart automatically. Close and reopen ShowDesk to finish the update."});return;}
 if(kind==="install"){const version=showDeskUpdater.currentVersion?("ShowDesk "+showDeskUpdater.currentVersion):"your current ShowDesk version";setUpdateModal({title:"Update wasn't installed",message:"Current version: "+version+".",primary:"TRY AGAIN",primaryAction:retry,closeLabel:"CANCEL"});return;}
 setUpdateModal({title:"Update download failed",message:detail,primary:"TRY AGAIN",primaryAction:retry,closeLabel:"CANCEL"});
}
function setUpdateModal({title,message,primary="",primaryAction=null,progress=false,close=true,closeLabel="CLOSE"}={}){
 const modal=$("updateProgressModal"),track=$("updateProgressTrack"),meta=$("updateProgressMeta"),btn=$("updatePrimaryBtn"),closeBtn=$("updateCloseBtn");if(!modal)return;
 modal.hidden=false;$("updateProgressTitle").textContent=title||"ShowDesk Update";$("updateProgressMessage").textContent=message||"";
 track.hidden=!progress;meta.hidden=!progress;modal.classList.toggle("indeterminate",false);if(!progress){$("updateProgressFill").style.width="";$("updateProgressPercent").textContent="";$("updateProgressBytes").textContent="";}closeBtn.hidden=!close;closeBtn.textContent=closeLabel;btn.hidden=!primary;btn.textContent=primary||"";btn.onclick=primaryAction;
}
function closeUpdateModal(){if(showDeskUpdater.phase==="downloading"||showDeskUpdater.phase==="installing")return;const modal=$("updateProgressModal");if(modal)modal.hidden=true}
function showUpdateAvailable(result,manual){
 showDeskUpdater.phase="available";showDeskUpdater.available=result;
 setUpdateModal({title:"Update available",message:"ShowDesk "+result.version+" is ready to download. ShowDesk will not download it until you choose Download Update.",primary:"DOWNLOAD UPDATE",primaryAction:installShowDeskUpdate});
 if(!manual)setTimeout(()=>{if(showDeskUpdater.phase==="available"){const modal=$("updateProgressModal");if(modal)modal.hidden=true;toast("UPDATE AVAILABLE • "+result.version)}},4500);
}
function showUpdateProgress(detail={}){
 const phase=detail.phase||"downloading",modal=$("updateProgressModal"),fill=$("updateProgressFill"),percent=$("updateProgressPercent"),bytes=$("updateProgressBytes");if(!modal)return;
 showDeskUpdater.phase=phase;setUpdateModal({title:phase==="downloading"?"Downloading "+(detail.version?("ShowDesk "+detail.version):"update")+"…":phase==="installing"?"Installing update…":"Restarting ShowDesk…",message:phase==="downloading"?"You can continue once the signed update finishes downloading.":phase==="installing"?"Verifying and installing ShowDesk. Do not close the app.":"The update is installed. ShowDesk is restarting.",progress:true,close:false});
 modal.classList.toggle("indeterminate",phase==="downloading"&&!detail.total);
 if(phase==="downloading"){const total=Number(detail.total)||0,downloaded=Number(detail.downloaded)||0;if(total>0){const pct=Math.max(0,Math.min(100,Math.round(downloaded/total*100)));fill.style.width=pct+"%";percent.textContent=pct+"%";bytes.textContent=formatUpdateBytes(downloaded)+" of "+formatUpdateBytes(total);}else{fill.style.width="";percent.textContent="DOWNLOADING";bytes.textContent=formatUpdateBytes(downloaded)+" downloaded";}}
 else{modal.classList.remove("indeterminate");fill.style.width="100%";percent.textContent=phase==="installing"?"100%":"COMPLETE";bytes.textContent=phase==="installing"?"Download complete":"";}
}
async function ensureUpdateProgressListener(){
 const internals=window.__TAURI_INTERNALS__;if(!internals)return;const listen=internals.event?.listen;
 if(typeof listen==="function"){await listen("showdesk-update-progress",event=>showUpdateProgress(event.payload||{}));await listen("showdesk-native-menu",event=>{if(event.payload==="check-for-updates")checkForShowDeskUpdate(true);else if(event.payload==="disconnect")disconnectShowDesk();});return;}
 if(typeof internals.invoke==="function"){const transform=internals.transformCallback;if(typeof transform!=="function")throw new Error("Tauri event bridge is unavailable.");for(const [event,handler] of [["showdesk-update-progress",e=>showUpdateProgress(e.payload||{})],["showdesk-native-menu",e=>{if(e.payload==="check-for-updates")checkForShowDeskUpdate(true);else if(e.payload==="disconnect")disconnectShowDesk();}]]){const id=transform(handler);await internals.invoke("plugin:event|listen",{event,target:{kind:"Any"},handler:id});}}
}
async function installShowDeskUpdate(){
 const invoke=tauriInvoke();if(!invoke||showDeskUpdater.operation)return;
 showDeskUpdater.operation="install";showUpdateProgress({phase:"downloading",version:showDeskUpdater.available?.version});
 try{await invoke("install_update")}
 catch(error){showDeskUpdater.phase="failed";showUpdaterFailure(updaterFailureKind(error),error);}
 finally{showDeskUpdater.operation=null}
}
async function checkForShowDeskUpdate(manual=false){
 const invoke=tauriInvoke();if(!invoke)return;if(showDeskUpdater.operation){if(manual)toast("UPDATE ALREADY IN PROGRESS");return showDeskUpdater.operation;}
 showDeskUpdater.operation="check";showDeskUpdater.phase="checking";
 if(manual)setUpdateModal({title:"Checking for updates…",message:"Checking the signed ShowDesk update feed.",close:false});
 try{const result=await invoke("check_for_update");if(result?.currentVersion)showDeskUpdater.currentVersion=result.currentVersion;if(result?.available)showUpdateAvailable(result,manual);else{showDeskUpdater.phase="current";showDeskUpdater.available=null;if(manual)setUpdateModal({title:"ShowDesk is up to date",message:"You are running the latest published version."});}}
 catch(error){showDeskUpdater.phase="failed";if(manual)showUpdaterFailure("check",error);else console.error("ShowDesk update check failed:",error);}
 finally{showDeskUpdater.operation=null}
}
window.checkForShowDeskUpdate=checkForShowDeskUpdate;
document.addEventListener("DOMContentLoaded",()=>{const close=$("updateCloseBtn");if(close)close.onclick=closeUpdateModal;if(tauriInvoke()){ensureUpdateProgressListener().then(()=>setTimeout(()=>checkForShowDeskUpdate(false),1200)).catch(console.error)}});
