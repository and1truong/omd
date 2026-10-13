// Load the released extension; grant exact fixture origins only in this temporary test copy.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {chromium} from 'playwright';
import {startServer} from './server.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const temp=await mkdtemp(join(tmpdir(),'omd-lime-')),extension=join(temp,'extension');await mkdir(extension);
const settings=JSON.parse(await readFile(join(root,'desktop/orchard.json'),'utf8'));
execFileSync('unzip',['-q',join(root,'.desktop/downloads',settings.assets.lime.file),'-d',extension]);
const manifest=JSON.parse(await readFile(join(extension,'manifest.json'),'utf8'));
manifest.host_permissions=[settings.origin+'/*','http://127.0.0.1:4311/*'];
await writeFile(join(extension,'manifest.json'),JSON.stringify(manifest));
const assets=await startServer(join(root,'dist'),settings.origin);
let pageId,calls=0,context;
const gateway=createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer omd-test-token'){res.writeHead(401).end();return;}
  if(req.url==='/v1/models'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:[{id:'omd-test-model'}]}));return;}
  if(req.url!=='/v1/chat/completions'){res.writeHead(404).end();return;}
  let raw='';for await(const part of req)raw+=part;
  const body=JSON.parse(raw);res.writeHead(200,{'Content-Type':'text/event-stream'});
  const delta=body.messages.at(-1)?.role==='tool'?{content:'Done.'}:{tool_calls:[{index:0,id:'omd-test-'+(++calls),type:'function',function:{name:'omd_add_block',arguments:JSON.stringify({pageId,type:'text',text:'Lime approved this edit'})}}]};
  res.end('data: '+JSON.stringify({choices:[{index:0,delta,finish_reason:delta.tool_calls?'tool_calls':'stop'}]})+'\n\ndata: [DONE]\n\n');
});await new Promise(r=>gateway.listen(4311,'127.0.0.1',r));
try{
  context=await chromium.launchPersistentContext(join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0]??await context.waitForEvent('serviceworker');
  const page=await context.newPage();await page.goto(settings.origin);await page.waitForFunction(()=>window.agentBridgeV1);
  const before=await page.evaluate(()=>window.agentBridgeV1.getContext());pageId=before.selectionIds[0];
  const panel=await context.newPage();await panel.goto(`chrome-extension://${new URL(worker.url()).hostname}/sidepanel.html`);
  const option=panel.locator(`select[aria-label="Target picker"] option[data-url^="${settings.origin}"]`);await option.waitFor({state:'attached'});
  await panel.getByLabel('Target picker').selectOption(await option.getAttribute('value'));
  await panel.getByRole('button',{name:'Pin target',exact:true}).click();
  await panel.getByText('Document: '+before.documentId,{exact:false}).waitFor();
  await panel.getByLabel('Gateway token').fill('omd-test-token');await panel.getByRole('button',{name:'Load models'}).click();
  await panel.locator('select option',{hasText:'omd-test-model'}).waitFor({state:'attached'});
  await panel.getByRole('button',{name:'Consent to pinned target + model'}).click();
  await panel.getByRole('button',{name:'Send',exact:true}).click();
  await panel.getByRole('button',{name:'Approve',exact:true}).click();
  await page.waitForFunction(rev=>window.agentBridgeV1.getContext().then(c=>c.revision===rev),before.revision+1);
  await panel.getByRole('button',{name:'Send',exact:true}).waitFor({state:'visible'});
  await panel.getByRole('button',{name:'Send',exact:true}).click();
  await panel.getByRole('button',{name:'Deny',exact:true}).click();
  await panel.getByRole('button',{name:'Send',exact:true}).waitFor({state:'visible'});
  assert.equal((await page.evaluate(()=>window.agentBridgeV1.getContext())).revision,before.revision+1);
  const read=await page.evaluate(async before=>window.agentBridgeV1.invoke({requestId:crypto.randomUUID(),documentId:before.documentId,toolName:'omd_get_page',arguments:{pageId:before.selectionIds[0]},expectedRevision:null,idempotencyKey:null}),before);
  assert.equal(read.data.blocks.filter(b=>b.text==='Lime approved this edit').length,1);
  console.log('Released Lime extension passed against OMD: pin, consent, actual approval/denial and one durable edit.');
}finally{await context?.close();await new Promise(r=>assets.close(r));await new Promise(r=>gateway.close(r));await rm(temp,{recursive:true,force:true});}
