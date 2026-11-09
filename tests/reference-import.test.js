'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const app=fs.readFileSync('public/app.js','utf8');
const start=app.indexOf('function readReferenceFile(');
const end=app.indexOf('function clearReference(',start);
assert.ok(start>=0&&end>start,'Reference file reading should remain independently testable');

class MockFileReader{
 readAsText(file){this.result=file.contents;queueMicrotask(()=>this.onload())}
}
const readReferenceFile=vm.runInNewContext(`(${app.slice(start,end).trim().replace(/\n\s*$/, '')})`,{FileReader:MockFileReader});

(async()=>{
 assert.equal(await readReferenceFile({text:()=>Promise.resolve('modern API')}),'modern API','Use the native text API when supported');
 assert.equal(await readReferenceFile({contents:'fallback API'}),'fallback API','Read selected references through FileReader when native text is unavailable');
 console.log('Reference file import compatibility regression passed');
})().catch(error=>{console.error(error);process.exitCode=1});
