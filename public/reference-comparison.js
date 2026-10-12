(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.ShowDeskReferenceComparison=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  function hasValue(value){return value!==undefined&&value!==null&&value!=="";}
  function configurationChecks(metadata={},live={}){
    const checks=[];
    const add=(name,expected,actual,mode="text")=>{if(hasValue(expected))checks.push({name,expected,actual,mode});};
    if(metadata.format!=="ATEM Software Control")return checks;
    add("SWITCHER MODEL",metadata.product,live.productIdentifier);
    const expectedMes=metadata.mixEffects,actualMes=live.mixEffects;
    if(Array.isArray(expectedMes)){
      add("M/E BLOCK COUNT",expectedMes.length,Array.isArray(actualMes)?actualMes.length:undefined,"number");
      expectedMes.forEach((me,index)=>{
        const meIndex=Number(me.index)||index+1;
        const actualMe=Array.isArray(actualMes)?actualMes.find(item=>Number(item.index)===meIndex):null;
        const expectedKeys=me.upstreamKeyers;
        if(Array.isArray(expectedKeys)){
          add(`M/E ${meIndex} USK COUNT`,expectedKeys.length,actualMe?.upstreamKeyers?.length,"number");
          expectedKeys.forEach((key,keyIndex)=>{
            const keyIndex1=Number(key.index)||keyIndex+1;
            const actualKey=actualMe?.upstreamKeyers?.find(item=>Number(item.index)===keyIndex1);
            const prefix=`M/E ${meIndex} USK ${keyIndex1}`;
            add(`${prefix} TYPE`,key.type,actualKey?.type);
            add(`${prefix} FILL`,key.fill,actualKey?.fill);
            add(`${prefix} KEY`,key.key,actualKey?.key);
          });
        }
        add(`M/E ${meIndex} FTB RATE`,me.ftb?.rate,actualMe?.ftb?.rate,"number");
      });
    }
    const expectedDsks=metadata.downstreamKeyers,actualDsks=live.downstreamKeyers;
    if(Array.isArray(expectedDsks)){
      add("DSK COUNT",expectedDsks.length,Array.isArray(actualDsks)?actualDsks.length:undefined,"number");
      expectedDsks.forEach((key,index)=>{
        const keyIndex=Number(key.index)||index+1;
        const actualKey=Array.isArray(actualDsks)?actualDsks.find(item=>Number(item.index)===keyIndex):null;
        add(`DSK ${keyIndex} FILL`,key.fill,actualKey?.fill);
        add(`DSK ${keyIndex} KEY`,key.key,actualKey?.key);
      });
    }
    return checks;
  }
  function compareValues(expected,actual,mode="text"){
    if(!hasValue(actual)||actual==="—"||actual==="UNUSED")return "unverified";
    const left=mode==="number"?Number(expected):String(expected).trim().toLocaleLowerCase();
    const right=mode==="number"?Number(actual):String(actual).trim().toLocaleLowerCase();
    if(mode==="number"&&(!Number.isFinite(left)||!Number.isFinite(right)))return "unverified";
    return left===right?"matching":"mismatch";
  }
  return {configurationChecks,compareValues};
});
