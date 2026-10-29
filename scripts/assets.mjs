import fs from 'node:fs/promises';import path from 'node:path';import{createHash}from'node:crypto';
import{distributionSchema,distributionManifestSchema,distributionPath}from'../lib/source.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export async function atomic(file,value){await fs.mkdir(path.dirname(file),{recursive:true});const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(value));await fs.rename(tmp,file)}
export async function buildAssets(root,inputs){
 const assets=path.join(root,'assets');await fs.mkdir(assets,{recursive:true});
 let old;try{old=distributionManifestSchema.parse(JSON.parse(await fs.readFile(path.join(assets,'manifest.json'),'utf8')))}catch(e){if(e.code!=='ENOENT')throw e}
 const data=inputs.map(d=>distributionSchema.parse(d)).sort((a,b)=>a.symbol.localeCompare(b.symbol));
 if(new Set(data.map(d=>d.symbol)).size!==data.length)throw Error('Duplicate symbol');
 const items=data.map(d=>({symbol:d.symbol,version:d.version})),version=hash(JSON.stringify(items));
 const manifest=distributionManifestSchema.parse({schema:1,version,items});
 let prior=[];try{prior=JSON.parse(await fs.readFile(path.join(root,'.state/previous-items.json'),'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}
 const changed=!old||old.version!==manifest.version;
 const keep=new Set([...items,...(changed?old?.items??[]:prior)].map(i=>distributionPath(i.symbol,i.version)));
 for(const d of data){const file=path.join(assets,distributionPath(d.symbol,d.version));let existing;
  try{existing=distributionSchema.parse(JSON.parse(await fs.readFile(file,'utf8')))}catch(e){if(e.code!=='ENOENT')throw e}
  if(existing){if(existing.symbol!==d.symbol||existing.version!==d.version)throw Error('Immutable file mismatch');continue}
  await atomic(file,d);
 }
 // Immutable payloads exist before the small manifest is replaced.
 if(changed){await atomic(path.join(root,'.state/previous-items.json'),old?.items??[]);await atomic(path.join(assets,'manifest.json'),manifest)}
 const folder=path.join(assets,'v1/distribution');for(const symbol of await fs.readdir(folder)){for(const file of await fs.readdir(path.join(folder,symbol))){const relative='v1/distribution/'+symbol+'/'+file;if(!keep.has(relative))await fs.unlink(path.join(folder,symbol,file))}}
 return{changed,manifest,files:keep.size};
}
