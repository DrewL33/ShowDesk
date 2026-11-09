'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const html=fs.readFileSync('public/index.html','utf8');
const styles=fs.readFileSync('public/styles.css','utf8');
const app=fs.readFileSync('public/app.js','utf8');
const rust=fs.readFileSync('src-tauri/src/main.rs','utf8');
const bootstrap=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(bootstrap,'The detached-window startup marker should run before styles render');
assert.match(rust,/classList\.add\('undockedStartup'\)/,'Native detached windows should mark themselves during webview initialization');
const nativeWindowBuilder=rust.slice(rust.indexOf('tauri::WebviewWindowBuilder::new'),rust.indexOf('.build()',rust.indexOf('tauri::WebviewWindowBuilder::new')));
assert.ok(!nativeWindowBuilder.includes('.min_inner_size('),'Detached windows must allow OS tiling below their preferred initial size');
assert.match(styles,/html\.undockedStartup #setup\{display:none!important\}/,'The connection overlay must not flash over a detached workspace');
assert.match(styles,/html\.undockedWorkspace #setup,html\.undockedWorkspace #disconnectBtn/,'Detached workspaces must hide standalone connection controls');
assert.match(app,/if\(undockedWorkspace\)\{toast\("Manage the connection from the main ShowDesk window"\);return\}/,'Detached workspaces must not disconnect or reconnect the shared session themselves');
assert.match(app,/function initializeUndockedWorkspace\(\)[\s\S]*?ensureViewerConnectionSubscription\(transport\)[\s\S]*?transport\?\.attach\?\./,'Detached windows must subscribe to the main session through the shared local transport');
assert.doesNotMatch(app,/showdesk-redock-workspace/,'Returning a detached workspace must not switch the main window to that workspace');
assert.doesNotMatch(rust,/emit_to\("main",\s*"showdesk-redock-workspace"/,'Returning a detached workspace should leave the main window selection unchanged');
assert.doesNotMatch(app.slice(app.indexOf('function initializeUndockedWorkspace('),app.indexOf('async function redockWorkspace(',app.indexOf('function initializeUndockedWorkspace('))),/connectViewer\(|connectAtem\(/,'Detached windows must not create their own Host or Viewer connection');
assert.match(app,/if\(undockedWorkspace&&message\?\.status==="disconnected"\)\{clearDetachedConnectionState\(\);return\}/,'A detached Host view must not start a competing reconnect when the owner disconnects');
assert.match(app,/function adoptSharedViewerConnection\(/,'Viewer windows must adopt the main Viewer connection relay');
assert.match(fs.readFileSync('public/transport.js','utf8'),/publishViewerRelay\(message\)/,'The main Viewer must relay its read-only state to detached windows');
assert.match(fs.readFileSync('src/server.js','utf8'),/relayToOtherClients\(ws, shared\)/,'Viewer state relays must go only to the other local ShowDesk windows');

const classes=new Set();
vm.runInNewContext(bootstrap,{
 window:{SHOWDESK_UNDOCKED_CONTEXT:{workspace:'signal',connectionMode:'host',connectionHost:'192.168.1.20'}},
 location:{search:''},
 document:{documentElement:{classList:{add:name=>classes.add(name)}}},
 URLSearchParams
});
assert.ok(classes.has('undockedStartup'),'A detached window sharing an existing connection should hide setup before first paint');

const start=app.indexOf('function initializeUndockedWorkspace('),end=app.indexOf('async function redockWorkspace(',start);
assert.ok(start>=0&&end>start,'Detached workspace initialization should remain testable');
const element=()=>({hidden:false,textContent:'',classList:{values:new Set(),add(name){this.values.add(name)},remove(name){this.values.delete(name)}}});
const elements={setup:element(),undockedWorkspaceControls:element(),undockedWorkspaceTitle:element(),viewerHostIp:element()};
let attached=false,selected=null;
const context={
 URLSearchParams,location:{search:''},
 window:{SHOWDESK_UNDOCKED_CONTEXT:{workspace:'signal',connectionMode:'host',connectionHost:'192.168.1.20'},ATEM_TRANSPORT:{attach:()=>{attached=true;return Promise.resolve()}}},
 document:{documentElement:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}},querySelector:()=>({hidden:false})},
 showDeskPreferences:{hyperdeckMonitoring:true},workspaceTitles:{show:'Show View',signal:'Signal Explorer',engineering:'Inspect',hyperdecks:'HyperDeck Monitoring'},
 $(id){return elements[id]},setTab(tab){selected=tab},validIpLike(value){return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)},
 ensureHostConnectionSubscription(){},ensureViewerConnectionSubscription(){},ensureLiveStateSubscription(){}
};
const initialize=vm.runInNewContext('let undockedWorkspace=null;'+app.slice(start,end)+'\ninitializeUndockedWorkspace',context);
initialize();
assert.equal(selected,'signal','The requested workspace should open directly');
assert.ok(elements.setup.classList.values.has('hidden'),'The setup overlay should stay hidden after the workspace initializes');
assert.equal(elements.undockedWorkspaceTitle.textContent,'Signal Explorer','The detached window should retain its workspace title');
assert.ok(attached,'The detached window should attach to the shared Host transport');
assert.ok(!classes.has('undockedStartup'),'The pre-paint marker should be cleared after setup is hidden');
console.log('Undocked workspace startup regression passed');
