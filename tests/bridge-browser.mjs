// Exercise the built page, real IndexedDB and editor draft flush in both browser engines.
import assert from 'node:assert/strict';
import {chromium,webkit} from 'playwright';
import {startServer} from '../desktop/server.mjs';
import {fileURLToPath} from 'node:url';
const origin='http://127.0.0.1:33181';
const server=await startServer(fileURLToPath(new URL('../dist',import.meta.url)),origin);
const engine=process.env.OMD_BROWSER??'chromium';
const browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.OMD_BROWSER_EXECUTABLE?{executablePath:process.env.OMD_BROWSER_EXECUTABLE}:{})});
try{
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.waitForFunction(()=>window.agentBridgeV1);
  const context=await page.evaluate(()=>window.agentBridgeV1.getContext());
  await page.locator('#page-title').fill('Draft saved before agent context');
  const updated=await page.evaluate(()=>window.agentBridgeV1.getContext());
  assert.equal(updated.revision,context.revision+1);assert.match(updated.summary,/Draft saved/);
  const request={requestId:crypto.randomUUID(),documentId:updated.documentId,toolName:'omd_add_block',arguments:{pageId:updated.selectionIds[0],type:'text',text:'Browser bridge persistence'},expectedRevision:updated.revision,idempotencyKey:crypto.randomUUID()};
  const invoke=req=>page.evaluate(req=>window.agentBridgeV1.invoke(req),req);
  const one=await invoke(request);assert.equal(one.ok,true);
  await page.reload();await page.waitForFunction(()=>window.agentBridgeV1);
  assert.deepEqual(await invoke({...request,requestId:crypto.randomUUID()}),one);
  assert.equal((await page.evaluate(()=>window.agentBridgeV1.getContext())).revision,one.revision);
  assert.equal((await invoke({...request,idempotencyKey:crypto.randomUUID()})).error.code,'STALE_CONTEXT');
  const closing=await page.evaluate(async request=>{document.body.inert=true;const result=await window.agentBridgeV1.invoke(request);document.body.inert=false;return result;},request);
  assert.equal(closing.error.code,'CANCELLED');assert.deepEqual(errors,[]);
  console.log(`OMD Bridge browser acceptance passed (${engine}).`);
}finally{await browser.close();await new Promise(r=>server.close(r));}
