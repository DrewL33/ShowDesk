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
 document:{documentElement:{classList:{add:name=>classes.add(name),remove:name=>classes.delete(name)}}},
 showDeskPreferences:{hyperdeckMonitoring:true},workspaceTitles:{show:'Show View',signal:'Signal Explorer',engineering:'Inspect',hyperdecks:'HyperDeck Monitoring'},
 $(id){return elements[id]},setTab(tab){selected=tab},validIpLike(value){return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)},
 ensureHostConnectionSubscription(){},ensureLiveStateSubscription(){}
};
const initialize=vm.runInNewContext('let undockedWorkspace=null;'+app.slice(start,end)+'\ninitializeUndockedWorkspace',context);
initialize();
assert.equal(selected,'signal','The requested workspace should open directly');
assert.ok(elements.setup.classList.values.has('hidden'),'The setup overlay should stay hidden after the workspace initializes');
assert.equal(elements.undockedWorkspaceTitle.textContent,'Signal Explorer','The detached window should retain its workspace title');
assert.ok(attached,'The detached window should attach to the shared Host transport');
assert.ok(!classes.has('undockedStartup'),'The pre-paint marker should be cleared after setup is hidden');
console.log('Undocked workspace startup regression passed');
