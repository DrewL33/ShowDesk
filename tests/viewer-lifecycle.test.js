const fs=require('node:fs');
const path=require('node:path');
const root=process.cwd();
const assert=require('node:assert/strict');
const app=fs.readFileSync('public/app.js','utf8');
const transport=fs.readFileSync('public/transport.js','utf8');
const styles=fs.readFileSync('public/styles.css','utf8');
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
assert.match(app,/viewerReconnecting\?"VIEWER • RECONNECTING":activeConnectionMode\.toUpperCase\(\)\+" • CONNECTED"/,'Connected modes must show CONNECTED normally and Viewer must show RECONNECTING only during recovery');
assert.match(styles,/\/\* Build059 — consolidated native workspace visual system/,'Desktop CSS must use the consolidated workspace visual system');
assert.match(styles,/\.railNav\.on\{background:#1d252a/,'Active rail icon must have the approved neutral active surface');
assert.match(styles,/\.railNav:hover\{background:#1a2126/,'Rail icons must have a restrained hover state');
assert.match(styles,/\.hero\.pgm\{background:linear-gradient\(105deg,#211d1e/,'Program surface must retain only a subtle live tint');
assert.match(styles,/\.hero\.pvw\{background:linear-gradient\(105deg,#192229/,'Preview surface must retain only a subtle preview tint');
assert.match(styles,/\.signalWorkspace\{padding:18px/,'Signal Paths must use the consolidated workspace surface');
assert.match(styles,/\.engSummary\{grid-template-columns:minmax\(0,1\.15fr\)/,'Inspect must use the consolidated information layout');
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
