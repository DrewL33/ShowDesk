'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');

const stable = JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json', 'utf8'));
const beta = JSON.parse(fs.readFileSync('src-tauri/tauri.beta.conf.json', 'utf8'));
const stableWorkflow = fs.readFileSync('.github/workflows/build.yml', 'utf8');
const betaWorkflow = fs.readFileSync('.github/workflows/beta.yml', 'utf8');
const rust = fs.readFileSync('src-tauri/src/main.rs', 'utf8');
const runtimeConfig = fs.readFileSync('public/runtime-config.js', 'utf8');
const mobile = fs.readFileSync('public/mobile-viewer.html', 'utf8');
const assets = fs.readFileSync('src/static-assets.js', 'utf8');
const hostHtml = fs.readFileSync('public/index.html', 'utf8');
const hostApp = fs.readFileSync('public/app.js', 'utf8');

assert.equal(stable.productName, 'ShowDesk');
assert.equal(beta.productName, 'ShowDesk BETA');
assert.notEqual(stable.identifier, beta.identifier, 'Beta must install alongside the stable app');
assert.equal(beta.bundle.macOS.signingIdentity, '-', 'Beta macOS apps must have a complete ad-hoc bundle signature');
assert.ok(stable.plugins.updater.endpoints[0].includes('showdesk-stable-latest'));
assert.ok(beta.plugins.updater.endpoints[0].includes('showdesk-beta-latest'));
assert.match(betaWorkflow, /branches:\s*\[beta\]/, 'Beta workflow must follow the beta branch');
assert.match(betaWorkflow, /1\.1\.0-beta\.\$\{GITHUB_RUN_NUMBER\}/, 'Every Beta build must get an increasing updater version');
assert.match(betaWorkflow, /SHOWDESK_CHANNEL:\s*beta/, 'Beta build must compile the beta runtime channel');
assert.match(betaWorkflow, /name: Build isolated Beta application\n\s+shell: bash/, 'Cross-platform Beta build must use the shell syntax expected by its environment variables');
assert.match(betaWorkflow, /--bundles nsis/, 'Windows Beta packaging must avoid MSI prerelease version restrictions');
assert.match(betaWorkflow, /contents: write/, 'Only the Beta publishing job should request release write access');
assert.doesNotMatch(stableWorkflow, /showdesk-beta-latest/, 'Stable publishing must not overwrite the Beta feed');
assert.doesNotMatch(stableWorkflow, /branches:.*beta/, 'The stable workflow must not build the Beta branch');
assert.match(rust, /\("47831", "47832"\)/, 'The Beta native app must use independent service and Viewer ports');
assert.match(rust, /\.env\("SHOWDESK_PORT", service_port\)/);
assert.match(runtimeConfig, /"servicePort":47821,"viewerPort":47822/, 'Checked-in frontend runtime defaults must remain stable');
assert.match(mobile, /src="\/runtime-config\.js"/, 'Mobile Viewer must load the active channel port configuration');
assert.match(assets, /'\/runtime-config\.js'/, 'The Host must serve the channel configuration to phone Viewers');
assert.match(hostHtml, /data-change-action="hyperdeck-enabled"/, 'HyperDeck Monitoring must be an optional workspace setting');
assert.match(hostHtml, /id="hyperdeckBtn"[^>]*>HyperDeck Monitoring/, 'Enabling the feature must expose the matching workspace tab');
assert.match(hostHtml, /class="hyperdeckPage"[\s\S]*id="hyperdeckHost"/, 'The HyperDeck tab must let users add decks by IP');
assert.match(hostApp, /hyperdeckMonitoring\?hyperdeckConfigs:\[\]/, 'Deck connections should only run while optional monitoring is enabled');

console.log('ShowDesk stable and beta release channels are isolated.');
