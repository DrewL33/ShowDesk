(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  if(root)root.ShowDeskReferenceParser=api;
})(typeof window!=="undefined"?window:globalThis,function(){
  "use strict";
  function attrs(text){
    const out={}; String(text||"").replace(/([\w:-]+)\s*=\s*"([^"]*)"/g,(_,k,v)=>(out[k]=v,""));
    return out;
  }
  function elements(xml,tag){
    const re=new RegExp("<"+tag+"\\b([^>]*)\\/?"+">","gi"),out=[]; let m;
    while((m=re.exec(xml)))out.push(attrs(m[1]));
    return out;
  }
  function blocks(xml,tag){
    const re=new RegExp("<"+tag+"\\b([^>]*)>([\\s\\S]*?)<\\/"+tag+">","gi"),out=[]; let m;
    while((m=re.exec(xml)))out.push({attrs:attrs(m[1]),body:m[2]});
    return out;
  }
  function parseAtemSoftwareControlXml(xml){
    if(typeof xml!=="string"||!/<Profile\b/i.test(xml))throw new Error("Not an ATEM Software Control profile.");
    const profile=(elements(xml,"Profile")[0]||{});
    const sources=new Map();
    ["Input","Output","Media"].forEach(tag=>elements(xml,tag).forEach(x=>{
      if(x.id!==undefined)sources.set(String(x.id),x.longName||x.shortName||String(x.id));
    }));
    const sourceName=id=>sources.get(String(id))||String(id);
    const outputs=new Map(elements(xml,"Output").filter(x=>x.id!==undefined).map(x=>[String(x.id),x.longName||x.shortName||String(x.id)]));
    const routes={};
    elements(xml,"Auxiliary").forEach(x=>{
      if(x.id===undefined||x.input===undefined)return;
      routes[outputs.get(String(x.id))||("ATEM OUTPUT "+x.id)]=sourceName(x.input);
    });
    const mixEffects=blocks(xml,"MixEffectBlock").map((block,i)=>{
      const program=elements(block.body,"Program")[0]||{},preview=elements(block.body,"Preview")[0]||{},ftb=elements(block.body,"FadeToBlack")[0]||{};
      const keys=elements(block.body,"Key").map(k=>({index:Number(k.index)+1,type:k.type||null,fillId:k.inputFill??null,fill:sourceName(k.inputFill),keyId:k.inputCut??null,key:sourceName(k.inputCut),onAir:k.onAir==="True"}));
      return {index:Number(block.attrs.index??i)+1,programId:program.input??null,program:program.input!==undefined?sourceName(program.input):null,previewId:preview.input??null,preview:preview.input!==undefined?sourceName(preview.input):null,ftb:{isFullyBlack:ftb.isFullyBlack==="True"},upstreamKeyers:keys};
    });
    const downstreamKeyers=elements(xml,"DownstreamKey").map((k,i)=>({index:Number(k.index??i)+1,fillId:k.fillSource??null,fill:sourceName(k.fillSource),keyId:k.keySource??null,key:sourceName(k.keySource),onAir:k.onAir==="True"}));
    const first=mixEffects[0]||{};
    return {
      routes,
      pgm:first.program||null,
      pvw:first.preview||null,
      metadata:{format:"ATEM Software Control",product:profile.product||null,mixEffects,downstreamKeyers,sourceCount:sources.size}
    };
  }
  return {parseAtemSoftwareControlXml};
});
