import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'';
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4328',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser;const errors=[];
async function fresh(orientation='horizontal',nested=false) {
  const context=await browser.newContext({viewport:{width:1440,height:1200}}),page=await context.newPage();page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://localhost:4328${base}/`);
  const ids=await page.evaluate(async({orientation,nested})=>{
    window.app=await import(new URL('./src/app.js',document.baseURI));await app.ready;window.store=app.getStore();
    const {createTools}=await import(new URL('./src/webmcp.js',document.baseURI));window.tools=createTools(store,{flushPending:app.flushPending});
    let blockId=(await store.dispatch('add_block',{type:'tabs',title:'Final tab safety',orientation})).blockId;
    if(nested){const parent=store.getRenderState().blocks.find(b=>b.id===blockId);blockId=(await store.dispatch('add_block',{type:'tabs',containerId:parent.tabs[0].id,title:'Nested final safety',orientation:orientation==='horizontal'?'vertical':'horizontal'})).blockId;}
    const find=blocks=>{for(const block of blocks){if(block.id===blockId)return block;const child=find(block.tabs?.flatMap(t=>t.blocks)??[]);if(child)return child;}};
    const tabs=find(store.getRenderState().blocks);window.finalIds={pageId:store.getActivePageId(),blockId,tabId:tabs.tabs[1].id};return finalIds;
  },{orientation,nested});
  return {context,page,...ids};
}
const tool=(page,name,input={})=>page.evaluate(async({name,input})=>tools.find(tool=>tool.name===`omd_${name}`).execute(input),{name,input});
const idle=page=>page.evaluate(()=>store.idle());
const tick=page=>page.evaluate(()=>new Promise(requestAnimationFrame));
const title=page=>page.evaluate(async()=>{const {findBlock}=await import(new URL('./src/model.js',document.baseURI));return findBlock(await store.getPage(finalIds.pageId),finalIds.blockId,'tabs').block.tabs.find(t=>t.id===finalIds.tabId)?.title;});
async function rename(f,value,ime=false) {
  await f.page.locator(`[id="${f.tabId}-button"]`).press('F2');const input=f.page.getByRole('textbox',{name:'Rename tab',exact:true});
  if(ime)await input.evaluate((input,value)=>{window.imeInput=input;input.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));input.value=value;input.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));},value);
  else await input.fill(value);
  return input;
}
async function end(page) {await page.evaluate(()=>imeInput.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await tick(page);}
async function quota(page) {
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put,name=store.databaseName();window.restorePut=()=>{IDBObjectStore.prototype.put=put;};window.tabPuts=0;
    IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===name){tabPuts++;throw new DOMException('Final tab quota failure','QuotaExceededError');}return put.apply(this,args);};});
}
async function strictIME(orientation,nested) {
  const f=await fresh(orientation,nested),{page,context}=f,old=await title(page);
  await rename(f,'Tiếng Việt 世界 — final export',true);
  const revision=await page.evaluate(()=>store.getRevision());
  await tool(page,'get_page');assert.equal(await page.evaluate(()=>store.getRevision()),revision,'read tool skips preedit');
  await tool(page,'tab_update',{blockId:f.blockId,tabId:f.tabId,title:old});
  assert.equal(await page.evaluate(()=>store.getRevision()),revision+1,'scalar tool writes only its explicit mutation, not preedit');assert.equal(await title(page),old);
  await page.evaluate(()=>{
    const dispatch=store.dispatch;window.restoreDispatch=()=>{store.dispatch=dispatch;};
    store.dispatch=(name,...args)=>name==='tab_update'?new Promise((resolve,reject)=>{window.ackRename=()=>dispatch(name,...args).then(resolve,reject);}):dispatch(name,...args);
    window.exportDone=false;window.exportPromise=tools.find(t=>t.name==='omd_export_notebook').execute({}).then(result=>{exportDone=true;return result;});
  });
  await tick(page);assert.equal(await page.evaluate(()=>exportDone),false,'strict export waits for this composition');
  await end(page);assert.equal(await page.evaluate(()=>exportDone),false,'strict export waits for final persistence acknowledgement');
  await page.evaluate(()=>ackRename());
  const exported=await page.evaluate(async()=>JSON.parse((await exportPromise).json));
  const find=blocks=>{for(const block of blocks){if(block.id===f.blockId)return block;const child=find(block.tabs?.flatMap(t=>t.blocks)??[]);if(child)return child;}};
  assert.equal(find(exported.pages.find(p=>p.id===f.pageId).blocks).tabs.find(t=>t.id===f.tabId).title,'Tiếng Việt 世界 — final export');
  await page.evaluate(()=>restoreDispatch());
  await rename(f,'Tiếng Việt 世界 — before removal',true);
  await page.evaluate(()=>{window.removeDone=false;window.removePromise=tools.find(t=>t.name==='omd_tab_remove').execute({blockId:finalIds.blockId,tabId:finalIds.tabId}).then(()=>{removeDone=true;});});
  await tick(page);assert.equal(await page.evaluate(()=>removeDone),false);assert.equal(await title(page),'Tiếng Việt 世界 — final export');
  await end(page);await page.evaluate(()=>removePromise);await idle(page);assert.equal(await title(page),undefined);
  assert.equal(await page.getByRole('button',{name:'Retry tab rename',exact:true}).count(),0,'remove does not orphan the composing title');
  await page.evaluate(()=>store.undo());assert.equal(await title(page),'Tiếng Việt 世界 — before removal','rename ack precedes structural history');
  await rename(f,'Failed composition must block export',true);await quota(page);
  await page.evaluate(()=>{window.failedDone=false;window.failedExport=tools.find(t=>t.name==='omd_export_notebook').execute({}).then(()=>{throw new Error('Export should reject');},error=>{failedDone=true;return error.message;});});
  await end(page);assert.match(await page.evaluate(()=>failedExport),/Final tab quota/);assert.equal(await page.evaluate(()=>tabPuts),1,'failed ack is not silently retried');
  assert.equal(await page.getByRole('textbox',{name:'Rename tab',exact:true}).inputValue(),'Failed composition must block export');
  await page.evaluate(()=>restorePut());await page.getByRole('button',{name:'Cancel tab rename',exact:true}).click();
  await context.close();console.log(`${engine} ${base||'/'}: ${orientation} nested=${nested} strict inline IME export/remove/ack/failure and non-strict preedit passed.`);
}
try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='chromium'?{channel:'chromium'}:{})});
  await mkdir(`${root}/test-results`,{recursive:true});
  for(const orientation of ['horizontal','vertical'])for(const nested of [false,true])await strictIME(orientation,nested);
  assert.deepEqual(errors,[]);
} finally {await browser?.close();server.kill();}
