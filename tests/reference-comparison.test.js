'use strict';
const assert=require('node:assert/strict');
const {configurationChecks,compareValues}=require('../public/reference-comparison');

const reference={format:'ATEM Software Control',product:'ATEM Mini Extreme',mixEffects:[
  {index:1,upstreamKeyers:[{index:1,type:'Luma',fill:'Logo',key:'Graphics'}],ftb:{rate:30}},
  {index:2,upstreamKeyers:[],ftb:{rate:25}}
],downstreamKeyers:[{index:1,fill:'Logo',key:'Graphics'}]};
const live={productIdentifier:'atem mini extreme',mixEffects:[
  {index:1,upstreamKeyers:[{index:1,type:'Luma',fill:'Logo',key:'Camera'}],ftb:{rate:30}},
  {index:2,upstreamKeyers:[],ftb:{rate:25}}
],downstreamKeyers:[{index:1,fill:'Logo',key:'Graphics'}]};
const checks=configurationChecks(reference,live);
assert.equal(checks.find(x=>x.name==='SWITCHER MODEL').expected,'ATEM Mini Extreme');
assert.equal(checks.find(x=>x.name==='M/E BLOCK COUNT').actual,2);
assert.equal(checks.find(x=>x.name==='M/E 1 USK 1 TYPE').mode,'text');
assert.equal(compareValues('Luma','LUMA'),'matching','Text configuration values should compare case-insensitively');
assert.equal(compareValues(30,30,'number'),'matching');
const keyCheck=checks.find(x=>x.name==='M/E 1 USK 1 KEY');
assert.equal(compareValues(keyCheck.expected,keyCheck.actual,keyCheck.mode),'mismatch');
assert.equal(compareValues('Luma',undefined),'unverified','Unavailable live values must not be reported as mismatches');
assert.deepEqual(configurationChecks({format:'XML'},live),[],'Generic XML references should only compare values they explicitly support');
console.log('Reference configuration comparison regressions passed');
