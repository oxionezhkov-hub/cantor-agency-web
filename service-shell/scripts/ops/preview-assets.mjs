#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, readdirSync, statSync, chmodSync } from "node:fs";
import { resolve, relative, extname, join } from "node:path";
import { setGlobalProxyFromEnv } from "node:http";
setGlobalProxyFromEnv();
const require = createRequire("/workspace/.cloud-tools/package.json");
const { hash } = require("blake3-wasm");
const root = resolve("dist/client");
const sessionPath = "/workspace/.cloud-tools/config/cantor-assets-session.json";
const completionPath = "/workspace/.cloud-tools/config/cantor-assets-completion.json";
const mime = { ".html":"text/html", ".js":"application/javascript", ".css":"text/css", ".json":"application/json", ".webmanifest":"application/manifest+json", ".svg":"image/svg+xml", ".png":"image/png", ".woff2":"font/woff2", ".txt":"text/plain" };
function walk(directory) { return readdirSync(directory).flatMap(name => {const p=join(directory,name);return statSync(p).isDirectory()?walk(p):[p];}); }
function getManifest() {
 const manifest={};
 for(const p of walk(root)) {const content=readFileSync(p);manifest['/'+relative(root,p).replaceAll('\\','/')]={hash:hash(content.toString('base64')+extname(p).slice(1)).toString('hex').slice(0,32),size:content.length};}
 return manifest;
}
if(process.argv.includes('--manifest')) {console.log(JSON.stringify(getManifest()));}
else {
 const manifest=getManifest();
 const session=JSON.parse(readFileSync(sessionPath,'utf8'));
 let completion=session.buckets.length===0?session.jwt:null;
 for(const bucket of session.buckets) {
  const payload=new FormData();
  for(const digest of bucket) {
   const entry=Object.entries(manifest).find(([,info])=>info.hash===digest);
   if(!entry) throw new Error('Build changed after the upload session was created. Start a fresh session.');
   const content=readFileSync(join(root,entry[0]));
   payload.append(digest,new File([content.toString('base64')],digest,{type:mime[extname(entry[0])]||'application/octet-stream'}));
  }
  const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${session.accountId}/workers/assets/upload?base64=true`,{method:'POST',headers:{authorization:`Bearer ${session.jwt}`},body:payload,signal:AbortSignal.timeout(60000)});
  const result=await response.json();
  if(!response.ok||!result.success) throw new Error(`Asset upload failed: HTTP ${response.status}, ${result.errors?.map(e=>e.message).join(', ')}`);
  if(result.result?.jwt) completion=result.result.jwt;
 }
 if(!completion) throw new Error('Missing asset completion token');
 writeFileSync(completionPath,JSON.stringify({jwt:completion,files:Object.keys(manifest).length}));chmodSync(completionPath,0o600);
 console.log(JSON.stringify({uploaded:true,files:Object.keys(manifest).length}));
}
