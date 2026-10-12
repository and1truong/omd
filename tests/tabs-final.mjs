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
    await store.dispatch('page_add',{title:'Final safety fixture'});
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
async function unload(orientation,nested) {
  const f=await fresh(orientation,nested),{page,context}=f,old=await title(page),input=await rename(f,'');
  await input.pressSequentially('Unsaved keyboard draft');
  assert.equal((await page.locator('#save-status').innerText()).trim(),'Not saved');
  await quota(page);await input.press('Enter');await page.getByRole('button',{name:'Retry tab rename',exact:true}).waitFor();await idle(page);
  const dialogs=[];page.on('dialog',async dialog=>{dialogs.push(dialog.type());await dialog.dismiss();});
  await page.reload({timeout:1000}).catch(error=>{assert.match(error.message,/ERR_ABORTED|cancel|interrupt|Timeout/i);});
  assert.deepEqual(dialogs,['beforeunload'],'real reload after trusted keyboard input warns for a failed tab draft');
  assert.equal(await input.inputValue(),'Unsaved keyboard draft');assert.equal(await title(page),old);
  await page.evaluate(()=>{window.copied='';navigator.clipboard.writeText=async value=>{window.copied=value;};});
  await page.getByRole('button',{name:'Copy tab title draft',exact:true}).click();assert.equal(await page.evaluate(()=>copied),'Unsaved keyboard draft');
  await page.screenshot({path:`${root}/test-results/tabs-final-${engine}-${base?'project':'root'}-${orientation}-${nested?'nested':'root'}-failed.png`,fullPage:true});
  await page.evaluate(()=>restorePut());await page.getByRole('button',{name:'Retry tab rename',exact:true}).click();await input.waitFor({state:'detached'});await idle(page);
  assert.equal(await title(page),'Unsaved keyboard draft');assert.equal((await page.locator('#save-status').innerText()).trim(),'Saved');
  await rename(f,'Pending acknowledged title');
  await page.evaluate(()=>{const dispatch=store.dispatch;window.restoreDispatch=()=>{store.dispatch=dispatch;};store.dispatch=(name,...args)=>name==='tab_update'?new Promise((resolve,reject)=>{window.ackRename=()=>dispatch(name,...args).then(resolve,reject);}):dispatch(name,...args);});
  await page.getByRole('textbox',{name:'Rename tab',exact:true}).press('Enter');await tick(page);
  assert.equal((await page.locator('#save-status').innerText()).trim(),'Saving…');
  await page.reload({timeout:1000}).catch(error=>{assert.match(error.message,/ERR_ABORTED|cancel|interrupt|Timeout/i);});assert.equal(dialogs.length,2,'inflight inline persistence also protects a real reload');
  await page.evaluate(()=>ackRename());await page.getByRole('textbox',{name:'Rename tab',exact:true}).waitFor({state:'detached'});await idle(page);await page.evaluate(()=>restoreDispatch());
  await rename(f,'Discard this failed draft');await quota(page);await page.getByRole('textbox',{name:'Rename tab',exact:true}).press('Enter');await page.getByRole('button',{name:'Cancel tab rename',exact:true}).waitFor();
  await page.evaluate(()=>restorePut());await page.getByRole('button',{name:'Cancel tab rename',exact:true}).click();await idle(page);
  assert.equal((await page.locator('#save-status').innerText()).trim(),'Saved');assert.equal(await title(page),'Pending acknowledged title');
  await page.reload();assert.equal(dialogs.length,2,'discarded/acknowledged sessions do not warn');
  await context.close();console.log(`${engine} ${base||'/'}: ${orientation} nested=${nested} failed/inflight real beforeunload, keyboard dirty status, copy/retry/discard passed.`);
  const h=await fresh(orientation,nested),healthy=await rename(h,'');await healthy.pressSequentially('Healthy keyboard draft');
  await h.page.evaluate(()=>{const dispatch=store.dispatch;store.dispatch=(name,...args)=>name==='tab_update'?new Promise((resolve,reject)=>{window.ackRename=()=>dispatch(name,...args).then(resolve,reject);}):dispatch(name,...args);});
  const healthyDialogs=[];h.page.on('dialog',async dialog=>{healthyDialogs.push(dialog.type());await dialog.dismiss();});
  assert.equal((await h.page.locator('#save-status').innerText()).trim(),'Not saved');
  await h.page.reload({timeout:1000}).catch(error=>{assert.match(error.message,/ERR_ABORTED|cancel|interrupt|Timeout/i);});
  assert.deepEqual(healthyDialogs,['beforeunload'],'healthy dirty inline edit warns before beforeunload auto-save completes');
  assert.equal(await healthy.inputValue(),'Healthy keyboard draft');
  await h.page.evaluate(()=>ackRename());await healthy.waitFor({state:'detached'});await idle(h.page);assert.equal(await title(h.page),'Healthy keyboard draft');
  await h.page.locator(`[id="${h.tabId}-button"]`).press('F2');await h.page.reload();assert.equal(healthyDialogs.length,1,'unchanged open editor does not cause an unload warning');
  await h.context.close();
}
async function dragFixture(keepTabs=false) {
  const f=await fresh(),{page}=f;
  const data=await page.evaluate(async keepTabs=>{
    if(!keepTabs)await store.dispatch('remove_block',{blockId:finalIds.blockId});
    const one=(await store.dispatch('add_block',{type:'text',text:'one'})).blockId,two=(await store.dispatch('add_block',{type:'text',text:'two'})).blockId;
    const board=(await store.dispatch('add_block',{type:'kanban'})).blockId,columns=store.getRenderState().blocks.find(b=>b.id===board).columns;
    const first=(await store.dispatch('card_add',{blockId:board,columnId:columns[0].id,title:'First card'})).cardId,second=(await store.dispatch('card_add',{blockId:board,columnId:columns[1].id,title:'Second card'})).cardId;
    const source=store.getRenderState(),destination={...structuredClone(source),id:`${source.id}-copy`,title:'Same IDs page B'},notebook=await store.getNotebook();
    notebook.pages=[source,destination];notebook.activePageId=source.id;notebook.parents={[source.id]:'',[destination.id]:''};await store.dispatch('import_notebook',{notebook});
    return {one,two,board,first,second,source:source.id,destination:destination.id,columns:columns.map(c=>c.id)};
  },keepTabs);
  const col=i=>page.locator(`[data-block-id="${data.board}"] .kanban-column`).nth(i),card=id=>page.locator(`[data-card-id="${id}"]`),block=id=>page.locator(`[data-block-id="${id}"] > .block-controls`).getByRole('button',{name:'Drag block',exact:true});
  const paths=[
    ['block-slot',()=>block(data.two),()=>page.locator('.block-list[data-container="page"] > .drop-slot').first()],
    ['block-append',()=>block(data.one),()=>page.locator('.block-list[data-container="page"] > .add-block-button')],
    ['card-sibling',()=>card(data.first).getByRole('button',{name:'Drag card',exact:true}),()=>card(data.second)],
    ['card-append',()=>card(data.first).getByRole('button',{name:'Drag card',exact:true}),()=>col(2).locator('.cards')],
    ['column',()=>col(0).getByRole('button',{name:'Drag column',exact:true}),()=>col(2)]
  ];
  return {...f,data,paths};
}
async function pointerStart(page,source,target) {
  await source.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();await source.hover();const a=await source.boundingBox();assert.ok(a);
  await source.evaluate(el=>{window.dragSource=null;el.addEventListener('dragstart',event=>{window.dragSource=JSON.parse(event.dataTransfer.getData('application/x-omd'));},{once:true});});
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+10,a.y+a.height/2);
  await pointerOver(page,target);await pointerOver(page,target);
  assert.ok(await page.evaluate(()=>!!window.dragSource),'trusted pointer starts a native source drag');
}
async function pointerOver(page,target) {
  const b=await target.boundingBox();assert.ok(b);await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
}
const pages=f=>f.page.evaluate(async data=>({source:(await store.getPage(data.source)).blocks,destination:(await store.getPage(data.destination)).blocks}),f.data);
async function dragScope() {
  const f=await dragFixture(),{page,context,data}=f,baseline=await pages(f);
  for(const [kind,source,target] of f.paths) {
    for(const back of [false,true]) {
      await tool(page,'page_select',{pageId:data.source});await pointerStart(page,source(),target());
      assert.equal(await page.evaluate(()=>dragSource.pageId),data.source,'native source payload captures page identity');
      assert.equal(await target().evaluate(el=>el.classList.contains('drop-active')),true,`${kind} is a real native valid drag before switching`);
      await tool(page,'page_select',{pageId:data.destination});if(back)await tool(page,'page_select',{pageId:data.source});
      const revision=await page.evaluate(()=>store.getRevision());await pointerOver(page,target());
      assert.equal(await target().evaluate(el=>el.classList.contains('drop-active')),false);
      await page.mouse.up();await idle(page);assert.equal(await page.evaluate(()=>store.getRevision()),revision);assert.deepEqual(await pages(f),baseline,`${kind} switch${back?' and back':''} never changes either page`);
    }
    await tool(page,'page_select',{pageId:data.source});await pointerStart(page,source(),target());await page.mouse.up();await page.evaluate(()=>app.flushPending());await idle(page);
    const moved=await pages(f);assert.notDeepEqual(moved.source,baseline.source,`${kind} still works on its own page`);assert.deepEqual(moved.destination,baseline.destination);
    await page.evaluate(()=>store.undo());assert.deepEqual(await pages(f),baseline);
  }
  await context.close();
  for(let i=0;i<5;i++) {
    const f=await dragFixture(true),{page,data}=f,[kind,source,target]=f.paths[i],baseline=await pages(f);
    await rename(f,`Pending ${kind} belongs to source`,true);await pointerStart(page,source(),target());await page.mouse.up();await tick(page);
    assert.deepEqual((await pages(f)).source,baseline.source,'move waits for strict inline composition');
    await page.evaluate(pageId=>store.dispatch('page_select',{pageId}),data.destination);
    await end(page);await page.evaluate(()=>app.flushPending());await idle(page);
    const moved=await pages(f);assert.deepEqual(moved.destination,baseline.destination,`${kind} pending action cannot retarget identical IDs on B`);
    assert.notDeepEqual(moved.source,baseline.source);assert.equal(await title(page),`Pending ${kind} belongs to source`);
    await page.evaluate(()=>store.undo());assert.equal(await title(page),`Pending ${kind} belongs to source`,'undo removes move, not the preceding confirmed rename');
    await f.context.close();
  }
  console.log(`${engine} ${base||'/'}: native block/card/column slots+append reject page switch/round-trip and retain pending source IDs; own-page and undo paths passed.`);
}
try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true,...(engine==='chromium'?{channel:'chromium'}:{})});
  await mkdir(`${root}/test-results`,{recursive:true});
  if(!process.env.OMD_DRAG_ONLY) {
    for(const orientation of ['horizontal','vertical'])for(const nested of [false,true])await strictIME(orientation,nested);
    for(const orientation of ['horizontal','vertical'])for(const nested of [false,true])await unload(orientation,nested);
  }
  await dragScope();
  assert.deepEqual(errors,[]);
} finally {await browser?.close();server.kill();}
