import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import worker, { authorized, MAX_BODY } from "./notify-worker.mjs";
const now = Date.parse("2026-11-16T10:00:00Z");
const env = { CODEX_NOTIFY_SIGNING_KEY: "test-key-for-local-verification", CODEX_NOTIFY_EXPIRES_AT: "2026-11-16T17:00:00Z" };
function signed(path, body, timestamp = now) {
 const signature = createHmac("sha256", env.CODEX_NOTIFY_SIGNING_KEY).update(`${timestamp}\n${path}\n${body}`).digest("hex");
 return new Request(`https://test.local${path}`, { method: "POST", body, headers: { "x-cantor-timestamp": String(timestamp), "x-cantor-signature": signature } });
}
test("signature binds the exact message and path; old signatures and expired access fail", async () => {
 const body = JSON.stringify({text:"Ready for review"});
 assert.equal(await authorized(signed("/notify", body), env, body, now), true);
 assert.equal(await authorized(signed("/notify", body), env, body+" ", now), false);
 assert.equal(await authorized(signed("/identity", body), env, body, now+300001), false);
 assert.equal(await authorized(signed("/notify", body), {...env,CODEX_NOTIFY_EXPIRES_AT:new Date(now).toISOString()},body,now),false);
});
test("unauthorized requests do not expose or use bot credentials", async () => {
 const response=await worker.fetch(new Request("https://test.local/notify",{method:"POST",body:'{"text":"test"}'}),env);
 assert.equal(response.status,401);assert.deepEqual(await response.json(),{error:"unauthorized"});
});
test("large bodies are rejected before processing", async () => {
 const response=await worker.fetch(new Request("https://test.local/notify",{method:"POST",body:"x".repeat(MAX_BODY+1)}),env);
 assert.equal(response.status,413);
});
test("unknown routes are closed",async()=>{assert.equal((await worker.fetch(new Request("https://test.local/"),env)).status,404);});
test("authenticated sending is restricted to the configured owner",async()=>{
 const liveEnv={...env,CODEX_NOTIFY_EXPIRES_AT:new Date(Date.now()+60000).toISOString(),CONTROL_BOT_TOKEN:'local-test-token',CODEX_NOTIFY_OWNER:'123456'};
 const original=globalThis.fetch;
 const sent=[];
 globalThis.fetch=async(url,options)=>{sent.push({url:String(url),body:JSON.parse(options.body)});return Response.json({ok:true,result:{message_id:7,chat:{id:123456}}});};
 try {
  const body=JSON.stringify({text:'Test progress update'});
  const response=await worker.fetch(signed('/notify',body,Date.now()),liveEnv);
  assert.equal(response.status,200);assert.equal(sent.length,1);assert.equal(sent[0].body.chat_id,'123456');
  const redirect=JSON.stringify({text:'Test progress update',chat_id:'999'});
  assert.equal((await worker.fetch(signed('/notify',redirect,Date.now()),liveEnv)).status,422);
  assert.equal(sent.length,1);
 }finally{globalThis.fetch=original;}
});
