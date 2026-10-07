const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
const assert=require('node:assert/strict');
const app=fs.readFileSync('public/app.js','utf8');
const transport=fs.readFileSync('public/transport.js','utf8');
const styles=fs.readFileSync('public/styles.css','utf8');
const html=fs.readFileSync('public/index.html','utf8');
const server=fs.readFileSync('src/server.js','utf8');
assert.match(app,/function enterViewerConnection[\s\S]*?ensureLiveStateSubscription\(window\.ATEM_TRANSPORT\)/,'Viewer must subscribe to live state when entering Viewer mode');
assert.match(app,/function disconnectShowDesk[\s\S]*?clearLiveStateSubscription\(\)/,'Disconnect must clear the active live-state subscription');
assert.match(app,/connectionInputChanged\(\);viewerInputChanged\(\)/,'Disconnect must revalidate retained Host and Viewer addresses');
assert.match(transport,/function connectViewer[\s\S]*?viewerSocket = viewer/,'Direct Viewer socket must be tracked');
assert.match(transport,/disconnectViewer\(\) \{[\s\S]*?viewerSocket[\s\S]*?viewer\.close\(\)/,'Viewer disconnect must close the direct Viewer socket');
const directDisconnect=transport.slice(transport.indexOf('disconnectViewer() {'));
assert.ok(!directDisconnect.includes("request('disconnectViewerHost'")&&!directDisconnect.includes('request("disconnectViewerHost"'),'Direct Viewer disconnect must not use the retired backend relay');
assert.match(transport,/subscribeHealth\(callback\)/,'Transport must expose read-only health subscriptions');
assert.match(transport,/msg\.type === 'health'/,'Transport must forward Host health heartbeats');
assert.match(app,/transport\.subscribe\(\(patch\)=>\{markConnectionActivity\(\)/,'Live state must count as healthy connection activity');
assert.ok(!app.includes('• STALE'),'Operator-facing connection status must not show STALE while the transport remains connected');
assert.match(app,/function startConnectionHealth[\s\S]*?subscribeHealth/,'Connected Host and Viewer modes must subscribe to health events');
assert.match(app,/function stopConnectionHealth[\s\S]*?clearInterval/,'Disconnect must clean up connection health monitoring');
assert.match(app,/viewerReconnecting\?"VIEWER • RECONNECTING":activeConnectionMode==="host"&&hostReconnecting\?"HOST • RECONNECTING":activeConnectionMode\.toUpperCase\(\)\+" • CONNECTED"/,'Connection flag must expose Viewer and Host recovery states without falsely claiming CONNECTED');
assert.match(styles,/\/\* Build060 — approved slate workspace reference/,'Desktop CSS must use approved slate workspace visual system');
assert.match(styles,/\.showContent,\.signalPage,\.eng\{display:none!important\}/,'All workspaces hidden by default');
assert.match(styles,/\.tab-show \.showContent\{display:block!important\}/,'Show tab isolation');
assert.match(styles,/\.tab-signal \.signalPage\{display:block!important\}/,'Signal tab isolation');
assert.match(styles,/\.tab-engineering \.eng\{display:block!important\}/,'Inspect tab isolation');
assert.match(styles,/\.hero\.pgm\{background:linear-gradient\(105deg,#241f21/,'Restrained Program surface');
assert.match(styles,/\.hero\.pvw\{background:linear-gradient\(105deg,#182630/,'Restrained Preview surface');
assert.match(styles,/\.signalTree \.treeSource\[open\]>\.treeBranches\{background:#19242b!important/,'Expanded signal path slate hierarchy');
assert.match(styles,/\.engSummary\{grid-template-columns:minmax\(0,1\.15fr\)/,'Inspect consolidated layout');
assert.match(server,/function broadcastViewerCount\(\)[\s\S]*?viewerClients\.size/,'Host service must derive Viewer count from active Viewer sockets');
assert.match(server,/viewerClients\.add\(ws\);[\s\S]*?broadcastViewerCount\(\)/,'Viewer connect must refresh Host Viewer count');
assert.match(server,/viewerClients\.delete\(ws\); broadcastViewerCount\(\)/,'Viewer close must refresh Host Viewer count');
assert.match(transport,/subscribeViewerCount\(callback\)/,'Local Host transport must expose Viewer-count status');
assert.match(app,/activeConnectionMode==="host"&&count>0/,'Viewer count must be Host-only and hidden at zero');
console.log('Viewer lifecycle, health, toolbar, and Viewer-count regression checks passed');

// Build051 updater regression guards
{
 const app=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
 const rust=fs.readFileSync(path.join(root,'src-tauri','src','main.rs'),'utf8');
 const updaterStateDeclarations=app.match(/const showDeskUpdater=/g)||[];
 assert.equal(updaterStateDeclarations.length,1,'Updater must have one frontend state machine');
 assert.match(app,/const showDeskUpdater=\{[^}]*phase:"idle"[^}]*available:null[^}]*operation:null[^}]*currentVersion:null[^}]*\}/,'Updater state machine must retain operation, availability, phase, and installed-version state');
 assert(app.includes('ShowDesk will not download it until you choose Download Update.'),'Startup check must not auto-download');
 assert(app.includes('if(showDeskUpdater.operation)'),'Frontend must reject overlapping updater operations');
 assert(rust.includes('struct UpdaterBusy(Mutex<bool>);'),'Native updater must have a concurrency guard');
 assert(rust.includes('app.emit("showdesk-native-menu", "check-for-updates")'),'Native menu must route through the shared frontend updater');
 assert(!rust.includes('Install the update and restart ShowDesk?'),'Rust must not own a second install prompt');
 assert(app.includes('if(!progress){$("updateProgressFill").style.width="";$("updateProgressPercent").textContent="";$("updateProgressBytes").textContent="";}'),'Non-progress updater states must clear stale download progress');
 assert(app.includes('setUpdateModal({title:"ShowDesk is up to date",message:"You are running the latest published version."})'),'Current-version state must render the up-to-date modal without requesting progress UI');
 assert(app.includes('track.hidden=!progress;meta.hidden=!progress'),'Updater modal must hide progress elements whenever progress is not requested');
 assert(app.includes('closeLabel:"CANCEL"'),'Recoverable updater failures must offer Cancel');
 assert(app.includes('primary:"TRY AGAIN"'),'Recoverable updater failures must offer retry');
 assert(app.includes('showUpdaterFailure(updaterFailureKind(error),error)'),'Install/download failures must leave progress mode and enter a recoverable failure state');
 assert(app.includes('"currentVersion": current_version')===false,'Frontend must not hard-code the native current-version field');
 assert(rust.includes('"currentVersion": current_version'),'Native update checks must report the packaged current version');
 assert(app.includes('Current version: "+version+"."'),'Install verification failure must report the current installed ShowDesk version');
}

// Build052 reconnect regression guards
{
 const viewerTransport=fs.readFileSync(path.join(root,'public','transport.js'),'utf8');
 const viewerApp=fs.readFileSync(path.join(root,'public','app.js'),'utf8');
 assert(viewerTransport.includes('function scheduleViewerReconnect()'),'Viewer transport must schedule reconnects after established Host loss');
 assert(viewerTransport.includes('viewerReconnectInFlight'),'Viewer reconnect must prevent duplicate concurrent sockets');
 assert.match(viewerTransport,/disconnectViewer\(\) \{[\s\S]*?stopViewerReconnect\(\)/,'Intentional Viewer disconnect must disable reconnect before closing the socket');
 assert(viewerApp.includes('VIEWER • RECONNECTING'),'Viewer workspace must expose reconnecting state');
 assert(!viewerApp.includes('alert("ShowDesk Host connection lost.")'),'Viewer Host loss must not spam a blocking alert');
 assert.match(viewerApp,/async function connectViewer\(\)[\s\S]*?catch\(error\)[\s\S]*?TRY AGAIN/,'Initial Viewer connection failure must remain a normal retryable setup failure');
}

// Build053 remembered connection regression guards
{
 assert(app.includes('const SHOWDESK_CONNECTION_STORAGE_KEY="showdesk.connections.v1"'),'Connection addresses must use dedicated local persistence');
 assert.match(app,/function enterViewerConnection[\s\S]*?rememberSuccessfulConnection\("viewerHostIp",ip\)/,'Viewer Host IP must be saved only after Viewer connection succeeds');
 assert.match(app,/activeConnectionMode="host"[\s\S]*?rememberSuccessfulConnection\("atemIp",ip\)/,'ATEM IP must be saved only after Host discovery succeeds');
 assert.match(app,/function restoreRememberedConnections[\s\S]*?connectionInputChanged\(\);viewerInputChanged\(\)/,'Restored addresses must immediately revalidate Connect controls');
 assert(app.includes('restorePersistedReference();restoreRememberedConnections();updateReferenceUI();'),'Remembered addresses must restore during startup');
}

assert.match(styles,/\.activeSourcesPanel \.activeSourceGrid\{display:grid!important/,'Active Sources must retain card grid');
assert.match(styles,/\.eng \.matrixViewport\{height:300px!important/,'Routing Matrix must retain bounded viewport');
assert.match(styles,/\.settingsModal\{position:fixed!important;inset:0!important/,'Settings must remain a fixed modal overlay');
assert.match(styles,/\.settingsCard\{width:min\(520px/,'Settings must remain compact rather than full-screen');
assert.ok(!html.includes('Build057 • 0.1.57'),'Settings About must not expose stale Build057');
assert.match(html,/id="settingsBuild">Build064 • 0\.1\.64/,'Settings About must ship with the current Build064 fallback');

assert.match(app,/let committedMeState=new Map\(\)/,'Transition display must keep a committed M/E state');
assert.match(app,/transitioning&&committed\?\{\.\.\.me,pgm:committed\.pgm,pvw:committed\.pvw\}/,'Intermediate transitions must retain committed PGM/PVW');
assert.match(app,/function renderTransitionStatus\(\)/,'All-tab transition progress indicator must be rendered');
assert.match(app,/root&&!transitionActive/,'Signal Path pulse must be suppressed during an active transition');
assert.match(app,/ftbTransition/,'FTB transition must receive a flashing state class');
assert.match(styles,/\.ftbTransition\{animation:ftbFlash/,'FTB transition must visibly flash');
assert.match(styles,/\.meSelector \.meSelectBtn\.on\{[^}]*box-shadow:/,'M\/E selector must retain a selected-state indicator');
assert.match(styles,/\.transitionStatus\{position:fixed!important/,'Transition progress must remain visible across tabs');

assert.ok(!styles.includes('ShowDesk v5.0.6 Broadcast Console visual system'),'Legacy charcoal visual layer must be removed rather than overridden');
assert.ok(!styles.includes('background:#11161a!important;border-bottom-color:var(--accent)!important'),'Legacy charcoal selected-tab rule must not return');
assert.match(styles,/\.meSelector \.meSelectBtn\.on\{[^}]*background:#1c303b!important/,'M/E selection must use canonical blue-slate surface');
assert.match(styles,/\.referencePanel \.referenceEmpty,\.referencePanel \.referenceAttached\{background:var\(--sd-panel\)!important/,'Reference attachment surfaces must use canonical slate panel');
assert.match(app,/me\.ftb\?\(me\.ftb\.inTransition\?"TRANSITION":me\.ftb\.isFullyBlack\?"BLACK":"OFF"\)/,'FTB transition must take precedence over fully-black state');

// Build064 controlled Host/ATEM reconnect regression guards
assert.match(app,/function ensureHostConnectionSubscription\(transport\)/,'Host must subscribe to backend ATEM connection-loss events');
assert.match(app,/message\?\.status!==\"disconnected\"/,'Host reconnect must begin only from an explicit backend disconnect event');
assert.match(app,/HOST • RECONNECTING/,'Host connection flag must stop claiming CONNECTED while ATEM reconnects');
assert.match(app,/function scheduleHostReconnect\(transport\)[\s\S]*?2000/,'Host reconnect must retry on a controlled two-second cadence');
assert.match(app,/async function attemptHostReconnect\(transport\)[\s\S]*?transport\.connect\(ip\)/,'Host reconnect must reuse the established ATEM address through the existing read-only connect path');
assert.match(app,/intentionalDisconnect=true;viewerReconnecting=false;stopHostReconnect\(\)/,'Intentional disconnect must cancel Host reconnect');
