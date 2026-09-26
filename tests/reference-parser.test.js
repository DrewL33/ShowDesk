'use strict';
const assert=require('node:assert/strict');
const {parseAtemSoftwareControlXml}=require('../public/reference-parser');

const xml=`<?xml version="1.0"?><Profile majorVersion="2" minorVersion="1" product="ATEM 4 M/E Constellation HD">
<Inputs><Input id="1" shortName="C1" longName="Camera 1"/><Input id="15" shortName="ANCM" longName="Announcements"/></Inputs>
<Outputs><Output id="8001" shortName="ONL" longName="Online"/><Output id="8002" shortName="INR" longName="InRoom"/><Output id="10010" shortName="M/E1" longName="ME 1 - ONLINE"/><Output id="10020" shortName="M/E2" longName="ME 2 - IN ROOM"/></Outputs>
<MixEffectBlocks><MixEffectBlock index="0"><Program input="10020"/><Preview input="1"/><Keys><Key index="0" type="Luma" inputFill="15" inputCut="1" onAir="True"/></Keys><FadeToBlack rate="30" isFullyBlack="False"/></MixEffectBlock><MixEffectBlock index="1"><Program input="15"/><Preview input="1"/><Keys></Keys><FadeToBlack rate="30" isFullyBlack="True"/></MixEffectBlock></MixEffectBlocks>
<DownstreamKeys><DownstreamKey index="0" fillSource="15" keySource="1" onAir="True"/></DownstreamKeys>
<Auxiliaries><Auxiliary id="8001" input="10010"/><Auxiliary id="8002" input="10020"/></Auxiliaries>
</Profile>`;

const ref=parseAtemSoftwareControlXml(xml);
assert.equal(ref.metadata.format,'ATEM Software Control');
assert.equal(ref.metadata.product,'ATEM 4 M/E Constellation HD');
assert.equal(ref.pgm,'ME 2 - IN ROOM');
assert.equal(ref.pvw,'Camera 1');
assert.deepEqual(ref.routes,{Online:'ME 1 - ONLINE',InRoom:'ME 2 - IN ROOM'});
assert.equal(ref.metadata.mixEffects.length,2);
assert.equal(ref.metadata.mixEffects[0].upstreamKeyers[0].fill,'Announcements');
assert.equal(ref.metadata.mixEffects[1].ftb.isFullyBlack,true);
assert.equal(ref.metadata.downstreamKeyers[0].fill,'Announcements');
assert.throws(()=>parseAtemSoftwareControlXml('<foo/>'),/ATEM Software Control/);
console.log('ATEM reference parser regression passed');
