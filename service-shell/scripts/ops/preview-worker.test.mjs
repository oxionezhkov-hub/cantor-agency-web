import test from "node:test";
import assert from "node:assert/strict";
import worker from "./preview-worker.mjs";
test("preview cannot forward production API requests", async () => {
 for(const path of ['/api/dashboard/bootstrap','/api/avito/accounts','/_serverFn/anything']){
  const response=await worker.fetch(new Request('https://preview.test'+path),{ASSETS:{fetch(){throw new Error('should not fetch');}}});
  assert.equal(response.status,503);assert.equal((await response.json()).error,'preview_only');
 }
});
test("HTML remains fresh and carries noindex without hiding the demo from its owner", async () => {
 const response=await worker.fetch(new Request('https://preview.test/'),{ASSETS:{fetch:async()=>new Response('<html>Demo</html>',{headers:{'content-type':'text/html'}})}});
 assert.equal(response.status,200);assert.equal(response.headers.get('x-robots-tag'),'noindex, nofollow');assert.equal(response.headers.get('cache-control'),'no-store');
});
