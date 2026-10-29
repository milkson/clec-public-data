import fs from'node:fs/promises';import path from'node:path';
import{refreshHistory,distributionSchema}from'../lib/source.mjs';import{atomic,buildAssets}from'./assets.mjs';
if(!process.argv.includes('--fetch'))throw Error('Explicit --fetch required; this performs public source reads');
const root=process.cwd(),symbols=['00662','00670L','00631L','00685L','00865B'],today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const file=path.join(root,'.state/checkpoint.json'),state=JSON.parse(await fs.readFile(file,'utf8'));
if(state.source.blocked||Date.parse(state.source.cooldownUntil??'')>Date.now())throw Error('Source paused; preserve cache and review source state');
let requests=0;const accepted=[];
try{
 const cycle=state.activeCycle??today;state.activeCycle=cycle;await atomic(file,state);
 for(const symbol of symbols){
  const saved=state.items[symbol];let data=distributionSchema.parse(saved.data),progress=saved.progress;
  const refresh=async(p)=>refreshHistory(symbol,data,{mode:'weekly',progress:p,beforeRequest:async()=>{if(requests>=80)throw Object.assign(Error('Bounded source job limit'),{kind:'review'})},fetcher:async(url,options)=>{requests++;return fetch(url,options)},checkpoint:async(d,p)=>{
    state.source={cooldownUntil:p.cooldownUntil};state.items[symbol]={data:d,progress:{...p,cycle}};
    await atomic(file,state);
  }});
  if(!(progress?.finished&&progress.cycle===cycle))data=await refresh(progress);
  accepted.push(data);
 }
 const result=await buildAssets(root,accepted);state.activeCycle=undefined;state.lastRun={at:new Date().toISOString(),success:true,changed:result.changed,requests};await atomic(file,state);console.log(JSON.stringify({success:true,changed:result.changed,requests}));
}catch(error){
 if(error.kind==='review'||[401,403].includes(error.status))state.source.blocked=error.kind==='review'?'review':'authorization';
 if(error.status===429)state.source.cooldownUntil=error.retryAt??new Date(Date.now()+300000).toISOString();
 state.lastRun={at:new Date().toISOString(),success:false,reason:error.message,requests};await atomic(file,state);
 console.error('Update paused; accepted assets retained. See source state.');process.exitCode=1;
}
