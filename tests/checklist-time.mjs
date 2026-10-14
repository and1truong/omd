import {waitForServer} from './server-ready.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const root=new URL('..',import.meta.url).pathname,engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'',url=`http://localhost:4335${base}/`;
const startServer=()=>spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4335',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});let server=startServer(),browser,page,blockId;
const listening=()=>waitForServer(server);
const ready=()=>page.evaluate(async()=>{window.timeApp=await import(new URL('./src/app.js',document.baseURI).href);await timeApp.ready;});
const call=(name,input={})=>page.evaluate(async({name,input})=>{await timeApp.flushPending();const store=timeApp.getStore();return name==='undo'?store.undo():name==='redo'?store.redo():store.dispatch(name,input);},{name,input});
const items=()=>page.evaluate(async blockId=>{await timeApp.flushPending();const {findBlock}=await import(new URL('./src/model.js',document.baseURI).href);return findBlock(timeApp.getStore().getState(),blockId,'checklist').block.items;},blockId);
const row=id=>page.locator(`[data-item-id="${id}"] > .check-row`),time=id=>row(id).locator('time'),editor=id=>page.locator(`[id="${id}"]`);
try{
  await listening();browser=await({chromium,webkit}[engine]).launch();const context=await browser.newContext({viewport:{width:1280,height:900},locale:'en-US',timezoneId:'Asia/Ho_Chi_Minh'});context.setDefaultTimeout(10000);page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await ready();
  await call('page_add',{title:'Completion dates'});blockId=(await call('add_block',{type:'checklist',title:'Old and new tasks'})).blockId;
  const legacy=await page.evaluate(async blockId=>{
    const store=timeApp.getStore(),book=JSON.parse(await store.export()),list=book.pages.find(p=>p.id===store.getActivePageId()).blocks.find(b=>b.id===blockId);
    list.items=[{id:crypto.randomUUID(),text:'Legacy completed task',done:true},{id:crypto.randomUUID(),text:'Null completion time',done:true,completedAt:null},{id:crypto.randomUUID(),text:'Empty completion time',done:true,completedAt:''},{id:crypto.randomUUID(),text:'Known completed task',done:true,completedAt:'2026-10-12T14:15:16+07:00'},{id:crypto.randomUUID(),text:'Unchecked historical data',done:false,completedAt:'2025-01-01T00:00:00Z'}];
    await store.import(JSON.stringify(book));return list.items;
  },blockId);
  for(const item of legacy.slice(0,3))assert.equal(await time(item.id).count(),0);assert.equal(await time(legacy[4].id).count(),0);
  assert.equal(await time(legacy[3].id).getAttribute('datetime'),'2026-10-12T07:15:16.000Z');assert.equal(await time(legacy[3].id).innerText(),'Completed Oct 12, 2026, 2:15 PM');assert.match(await time(legacy[3].id).getAttribute('title'),/2026/);
  await editor(legacy[0].id).fill('Edited old checked task');await call('checklist_update',{blockId,itemId:legacy[0].id,patch:{done:true}});assert.equal(await time(legacy[0].id).count(),0);assert.equal((await items())[0].completedAt,undefined);
  await page.reload();await ready();for(const item of legacy.slice(0,3))assert.equal(await time(item.id).count(),0);assert.equal((await items())[1].completedAt,null);assert.equal((await items())[2].completedAt,'');
  const id=(await call('checklist_add',{blockId,text:'**New** task'})).itemId;assert.equal(await time(id).count(),0);await page.clock.setFixedTime(new Date('2026-10-13T07:15:16Z'));
  await row(id).getByRole('checkbox').check();await time(id).waitFor();const stamp=(await items()).find(item=>item.id===id).completedAt;assert.equal(stamp,'2026-10-13T07:15:16.000Z');assert.equal(await time(id).innerText(),'Completed Oct 13, 2026, 2:15 PM');
  await editor(id).fill('Edited after completion');await call('checklist_update',{blockId,itemId:id,patch:{done:true}});assert.equal((await items()).find(item=>item.id===id).completedAt,stamp);
  await row(id).getByRole('checkbox').uncheck();await time(id).waitFor({state:'detached'});assert.equal((await items()).find(item=>item.id===id).completedAt,undefined);await call('undo');assert.equal(await time(id).getAttribute('datetime'),stamp);await call('redo');assert.equal(await time(id).count(),0);
  await page.clock.setFixedTime(new Date('2026-10-13T07:16:16Z'));await row(id).getByRole('checkbox').check();await time(id).waitFor();assert.equal((await items()).find(item=>item.id===id).completedAt,'2026-10-13T07:16:16.000Z');
  // Nested checklist transitions use the same action as the UI; ancestors stay independent.
  const tabs=(await call('add_block',{type:'tabs'})).block,toggle=(await call('add_block',{type:'toggle',containerId:tabs.tabs[0].id})).block;
  const nested=(await call('add_block',{type:'checklist',containerId:toggle.id})).blockId,parent=(await call('checklist_add',{blockId:nested,text:'Parent'})).itemId,child=(await call('checklist_add',{blockId:nested,parentId:parent,text:'Child'})).itemId;
  await call('checklist_update',{blockId:nested,itemId:child,patch:{done:true}});assert.equal(await time(child).getAttribute('datetime'),'2026-10-13T07:16:16.000Z');assert.equal(await time(parent).count(),0);
  await call('checklist_move',{blockId:nested,itemId:child,parentId:'',index:1});assert.equal(await time(child).getAttribute('datetime'),'2026-10-13T07:16:16.000Z');
  const exported=await page.evaluate(()=>timeApp.getStore().export());await page.reload();await ready();assert.equal(await time(id).getAttribute('datetime'),'2026-10-13T07:16:16.000Z');assert.equal(await time(child).getAttribute('datetime'),'2026-10-13T07:16:16.000Z');await page.evaluate(json=>timeApp.getStore().import(json),exported);assert.equal(await time(id).getAttribute('datetime'),'2026-10-13T07:16:16.000Z');
  // A rejected transaction must not show a completion date that was never stored.
  const failed=(await call('checklist_add',{blockId,text:'Failed save'})).itemId;await page.evaluate(()=>{window.timePut=IDBObjectStore.prototype.put;const db=timeApp.getStore().databaseName();IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===db)throw new DOMException('Completion quota','QuotaExceededError');return timePut.apply(this,args);};});
  await row(failed).getByRole('checkbox').check();await page.locator('.notice.error').filter({hasText:'Completion quota'}).first().waitFor();assert.equal(await time(failed).count(),0);assert.equal((await items()).find(item=>item.id===failed).done,false);await page.evaluate(()=>{IDBObjectStore.prototype.put=timePut;});
  // Completed time stays saved and renders after a real offline boot.
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;
  await row(failed).getByRole('checkbox').uncheck();await row(failed).getByRole('checkbox').check();await time(failed).waitFor();const offlineStamp=(await items()).find(item=>item.id===failed).completedAt;
  await page.reload();await ready();assert.equal(await time(failed).getAttribute('datetime'),offlineStamp);assert.equal(await time(legacy[0].id).count(),0);server=startServer();await listening();
  await mkdir(`${root}/test-results`,{recursive:true});for(const theme of ['light','dark']){await page.evaluate(theme=>timeApp.setView({theme,sidebarOpen:false}),theme);await page.screenshot({path:`${root}/test-results/checklist-times-${engine}-${base?'project':'root'}-${theme}.png`});}
  await page.setViewportSize({width:320,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`${root}/test-results/checklist-times-${engine}-${base?'project':'root'}-mobile.png`});
  assert.deepEqual(errors,[]);await context.close();console.log(`${engine} ${base||'/'}: legacy/missing dates, local completion time, transitions, history, nesting, reload/JSON, failed transactions, real offline boot and mobile layout passed.`);
}finally{await browser?.close();server.kill();}
