import assert from 'node:assert/strict';
import {mkdtemp,rm,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {startCloudflare} from './cloudflare-helper.mjs';
import {createStore} from '../src/store.ts';
import {openCloudflareRepository} from '../src/cloudflare-repository.ts';
import {metadataBook,pageRecords,recordChanges} from '../src/records.ts';
import {applyBookAction} from '../src/notebook.ts';
import {emptyNotebook,makeBlock} from '../src/model.ts';
const memory=()=>({getItem:()=>null,setItem:()=>{}}),temporary=await mkdtemp(join(tmpdir(),'omd D1 persisted '));
let worker=await startCloudflare({state:join(temporary,'state')}),browser;const stores=[];
try{
  const endpoint=worker.url+'/api/notebook';
  const open=async()=>{const store=await createStore(memory(),{cloudEndpoint:endpoint});stores.push(store);return store;};
  const first=await open(),initial=first.getState(),a=await first.dispatch('add_block',{type:'callout',text:'Stored in D1',icon:'💡',tone:'info'});
  await first.dispatch('update_block',{blockId:a.blockId,patch:{text:'Edited remotely'}});await first.undo();assert.equal(first.getState().blocks[0].text,'Stored in D1');await first.redo();assert.equal(first.getState().blocks[0].text,'Edited remotely');
  const second=await open();assert.equal(second.getState().blocks[0].text,'Edited remotely');
  const race=await Promise.allSettled([first.dispatch('add_block',{type:'heading',text:'First writer'}),second.dispatch('add_block',{type:'heading',text:'Second writer'})]);assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.match(race.find(r=>r.status==='rejected').reason.message,/Another device|revision/);
  const current=await open(),book=JSON.parse(await current.export());assert.equal(book.pages[0].blocks.length,2);
  // Retry a committed request whose response was lost. Real D1 receipts must prevent duplication.
  let drop=true;const repository=await openCloudflareRepository(endpoint,async(...args)=>{const response=await fetch(...args);if(drop&&JSON.parse(args[1].body).operation==='commit'){drop=false;throw new Error('Lost acknowledgement');}return response;});
  const before=(await repository.read()).meta,page=(await repository.export()).pages[0],after=applyBookAction({...before,pages:[page]},'add_block',{type:'divider'}).state,next=metadataBook(after),changes=recordChanges(pageRecords(page),pageRecords(after.pages[0]));
  await repository.commit(before,next,changes);assert.equal((await repository.export()).revision,before.revision+1);assert.equal((await repository.export()).pages[0].blocks.length,3);
  // Reject malformed updates without changing the notebook or leaving orphan records.
  // A D1 constraint failure after earlier statements must roll the complete batch back.
  const journalId=crypto.randomUUID();
  async function titleCommit(title){const book=await repository.export(),expected=metadataBook(book),changed=applyBookAction(book,'set_page',{title}).state,meta=metadataBook(changed),delta=recordChanges(pageRecords(book.pages[0]),pageRecords(changed.pages[0]));return repository.commit(expected,meta,delta,{journalId,journal:{owner:'rollback-check',before:expected,after:meta,changes:[]}});}
  await titleCommit('Transaction baseline');const baseline=await repository.export();await assert.rejects(()=>titleCommit('Must roll back'),/Cloud storage unavailable/);assert.deepEqual(await repository.export(),baseline);
  const latest=await repository.read();const invalid=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'commit',session:'invalid',requestId:crypto.randomUUID(),expected:latest.meta,meta:{...latest.meta,revision:latest.meta.revision+1},changes:[{key:['orphan','block','x'],before:null,after:{kind:'block',pageId:'orphan',id:'x',data:{id:'x',type:'text',text:'not in a container'}}}]})});assert.equal(invalid.status,400);assert.equal((await repository.read()).meta.revision,latest.meta.revision);
  assert.equal((await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',origin:'https://another.example'},body:JSON.stringify({operation:'read',session:'cross-origin'})})).status,400);
  assert.equal((await fetch(worker.url+'/missing.js')).status,404);assert.equal((await fetch(worker.url+'/page/'+initial.id)).status,200);
  const large=await open(),unicode='x'.repeat(65400)+'💡'.repeat(2000),big=(await large.dispatch('add_block',{type:'text',text:unicode})).blockId;assert.equal((await large.getPage()).blocks.at(-1).text,unicode);assert.ok(worker.sql(`SELECT COUNT(*) AS n FROM records WHERE kind='block' AND id='${big}'`)[0].n>1);
  assert.equal((await repository.export()).pages[0].blocks.find(b=>b.id===big).text,unicode);
  const bridge={notebookId:large.getNotebookId(),expectedRevision:large.getRevision(),idempotencyKey:'cloud-bridge-repeat',semantic:'add once'};
  const result=await large.dispatch('add_block',{type:'text',text:'One agent edit'}, {},bridge);const repeated=await large.dispatch('add_block',{type:'text',text:'One agent edit'}, {},bridge);assert.deepEqual(repeated,result);
  // Reminder delivery stays recorded even when notebook history restores an unfired block.
  const reminder=(await large.dispatch('add_block',{type:'reminder',dueAt:'2020-01-01T00:00:00Z'})).blockId;
  await large.dispatch('reminder_fired',{blockId:reminder,firedAt:new Date().toISOString()});await large.undo();await large.redo();assert.equal((await large.dueReminders(Date.now())).some(r=>r.id===reminder),false);
  const exported=await large.export();await large.import(exported);assert.equal(JSON.parse(await large.export()).pages[0].blocks.at(-1).type,'reminder');
  // Two independent browser profiles share D1, without notebook data in IndexedDB or service-worker caching.
  browser=await chromium.launch();const one=await browser.newContext(),two=await browser.newContext(),p1=await one.newPage(),p2=await two.newPage(),errors=[];
  for(const p of [p1,p2]){p.on('pageerror',e=>errors.push(e.message));await p.goto(worker.url);await p.evaluate(async()=>{window.app=await import('/src/app.js');await app.ready;window.store=app.getStore();});}
  assert.equal(await p1.evaluate(()=>indexedDB.databases().then(d=>d.length)),0);assert.equal(await p1.evaluate(()=>navigator.serviceWorker.getRegistrations().then(r=>r.length)),0);
  assert.equal(await p1.locator('#storage-mode').textContent(),'Shared cloud notebook');assert.equal(await p1.locator('#save-status').textContent(),'Saved to cloud');
  const selected=await p1.evaluate(()=>store.dispatch('page_add',{title:'Cloud browser notes'}));await p1.getByRole('button',{name:'Add a block here',exact:true}).click();await p1.getByRole('button',{name:'Add callout',exact:true}).click();
  const editor=p1.getByRole('textbox',{name:'callout content',exact:true});await editor.fill('Across devices');await p1.waitForFunction(()=>store.getState().blocks[0]?.text==='Across devices');await p2.evaluate(()=>store.reload());
  assert.equal(await p2.evaluate(()=>store.listPages().some(p=>p.title==='Cloud browser notes')),true);assert.notEqual(await p2.evaluate(()=>store.getActivePageId()),selected.pageId);
  await p2.evaluate(id=>store.dispatch('page_select',{pageId:id}),selected.pageId);assert.equal(await p2.getByRole('textbox',{name:'callout content',exact:true}).textContent(),'Across devices');
  await p2.route('**/api/notebook',route=>route.abort());await p2.evaluate(()=>store.reload().catch(()=>{}));await p2.unroute('**/api/notebook');await p2.evaluate(()=>store.reload());assert.equal(await p2.locator('#save-status').textContent(),'Saved to cloud');
  await p1.route('**/api/notebook',route=>{const request=route.request().postDataJSON();return request.operation==='commit'&&request.meta.pages.some(p=>p.title==='Unsaved cloud title')?route.abort():route.continue();});
  await p1.getByRole('textbox',{name:'Page title',exact:true}).fill('Unsaved cloud title');await p1.waitForFunction(()=>document.getElementById('notices').textContent.includes('Cloud connection unavailable'));
  assert.equal(await p1.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);
  await p1.evaluate(()=>store.dispatch('add_block',{type:'heading',text:'An unrelated successful edit'}));
  assert.equal(await p1.getByRole('textbox',{name:'Page title',exact:true}).inputValue(),'Unsaved cloud title');assert.equal(await p1.locator('#save-status').textContent(),'Not saved');
  await p1.unroute('**/api/notebook');await p1.getByRole('textbox',{name:'Page title',exact:true}).press('Enter');await p1.waitForFunction(()=>store.getState().title==='Unsaved cloud title');await p1.getByRole('textbox',{name:'Page title',exact:true}).fill('Cloud browser notes');await p1.waitForFunction(()=>document.getElementById('save-status').textContent==='Saved to cloud');
  // A generic block field stays connected after failed writes and unrelated updates, then retries on flush.
  const heading=p1.getByRole('textbox',{name:'heading content',exact:true});await p1.route('**/api/notebook',route=>{const request=route.request().postDataJSON();return request.operation==='commit'&&request.changes.some(c=>c.after?.data?.text==='Unsaved heading')?route.abort():route.continue();});
  await heading.fill('Unsaved heading');await p1.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');await p1.evaluate(()=>store.dispatch('add_block',{type:'divider'}));assert.equal(await heading.inputValue(),'Unsaved heading');assert.equal(await p1.locator('#save-status').textContent(),'Not saved');
  await p1.unroute('**/api/notebook');await p1.evaluate(()=>app.flushPending());assert.equal(await heading.inputValue(),'Unsaved heading');assert.equal(await p1.locator('#save-status').textContent(),'Saved to cloud');
  // A tab rename draft blocks remote refresh and unload until it is saved or cancelled.
  const tabs=await p1.evaluate(()=>store.dispatch('add_block',{type:'tabs'})),tabId=tabs.block.tabs[0].id;
  await p1.locator(`[id="${tabId}-button"]`).press('F2');await p1.getByRole('textbox',{name:'Rename tab',exact:true}).fill('Uncommitted tab rename');
  assert.equal(await p1.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;}),true);await p1.waitForFunction(()=>!document.querySelector('.tab-title-input'));
  await p1.locator(`[id="${tabId}-button"]`).press('F2');await p1.getByRole('textbox',{name:'Rename tab',exact:true}).fill('Keep this rename draft');
  const peer=await open();await peer.dispatch('update_block',{pageId:selected.pageId,blockId:tabs.blockId,patch:{title:'Remote tabs update'}});await p1.evaluate(()=>store.reload());assert.equal(await p1.getByRole('textbox',{name:'Rename tab',exact:true}).inputValue(),'Keep this rename draft');
  await p1.getByRole('textbox',{name:'Rename tab',exact:true}).press('Escape');await p1.evaluate(()=>store.reload());assert.equal(await p1.getByRole('textbox',{name:'tabs title',exact:true}).inputValue(),'Remote tabs update');
  await p2.evaluate(()=>store.reload());
  await p1.route('**/api/notebook',route=>route.abort());await editor.fill('Draft while disconnected');await p1.waitForFunction(()=>document.getElementById('notices').textContent.includes('Cloud connection unavailable'));await p1.waitForTimeout(5500);assert.equal(await editor.textContent(),'Draft while disconnected');
  await p1.unroute('**/api/notebook');await p1.evaluate(async()=>{await app.flushPending();});await p2.evaluate(()=>store.reload());assert.equal(await p2.getByRole('textbox',{name:'callout content',exact:true}).textContent(),'Draft while disconnected');
  await p2.reload();await p2.evaluate(async()=>{window.app=await import('/src/app.js');await app.ready;window.store=app.getStore();});assert.equal(await p2.evaluate(()=>store.getActivePageId()),selected.pageId);assert.equal(await p2.getByRole('textbox',{name:'callout content',exact:true}).textContent(),'Draft while disconnected');
  await p1.setViewportSize({width:390,height:844});assert.equal(await p1.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await p1.setViewportSize({width:1280,height:880});await p1.getByRole('textbox',{name:'callout content',exact:true}).fill('This notebook is saved in Cloudflare D1. Open the same URL on another device to keep working.');await p1.evaluate(()=>app.flushPending());
  while(await p1.getByRole('button',{name:'Dismiss message',exact:true}).count())await p1.getByRole('button',{name:'Dismiss message',exact:true}).first().click();await p1.getByRole('textbox',{name:'Page title',exact:true}).focus();await p1.getByRole('textbox',{name:'Page title',exact:true}).press('Tab');await p1.mouse.move(0,0);
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});await p1.screenshot({path:new URL('../test-results/cloudflare-d1.png',import.meta.url).pathname});
  assert.deepEqual(errors,[]);await one.close();await two.close();
  const canvasStore=await open(),scene={elements:[],appState:{},files:{pixel:{id:'pixel',dataURL:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII='}}},canvas=(await canvasStore.dispatch('add_block',{type:'excalidraw',scene})).blockId;assert.deepEqual(JSON.parse(await canvasStore.export()).pages[0].blocks.find(b=>b.id===canvas).scene,scene);
  const bulk=JSON.parse(await canvasStore.export()),reminderPage=emptyNotebook();reminderPage.title='Bulk reminders';reminderPage.blocks=Array.from({length:1005},()=>makeBlock('reminder',{dueAt:'2099-01-01T00:00:00Z'}));bulk.pages.push(reminderPage);bulk.parents[reminderPage.id]='';await canvasStore.import(JSON.stringify(bulk));assert.equal((await canvasStore.getPage(reminderPage.id)).blocks.length,1005);
  const notebookId=(await repository.read()).meta.id;for(const store of stores)await store.close();repository.close();await worker.stop();worker=await startCloudflare({state:join(temporary,'state')});
  const reopened=await createStore(memory(),{cloudEndpoint:worker.url+'/api/notebook'});assert.equal(reopened.getNotebookId(),notebookId);assert.equal(reopened.listPages().some(p=>p.title==='Cloud browser notes'),true);await reopened.close();
  console.log('Real Worker/D1: persistence, concurrent CAS, undo/redo, lost-response replay, validation, Unicode parts, Bridge idempotency, reminder ledger, JSON import, independent browsers, drafts, mobile and restart passed.');
}finally{for(const store of stores)await store.close().catch(()=>{});await browser?.close();await worker.stop();await rm(temporary,{recursive:true,force:true});}
