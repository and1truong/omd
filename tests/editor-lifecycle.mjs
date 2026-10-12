import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'';
assert.ok(['chromium','webkit'].includes(engine));
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4335',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
const errors=[];let browser;
async function fresh() {
  const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});context.setDefaultTimeout(10000);
  const page=await context.newPage();await ready(page);return {context,page};
}
async function ready(page) {
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://localhost:4335${basePath}/`);
  await page.evaluate(async()=>{
    window.lifecycleApp=await import(new URL('./src/app.js',document.baseURI).href);await lifecycleApp.ready;
    window.lifecycleStore=lifecycleApp.getStore();window.lifecycleModel=await import(new URL('./src/model.js',document.baseURI).href);
  });
}
const call=(page,name,input={})=>page.evaluate(async({name,input})=>{await lifecycleApp.flushPending();return lifecycleStore.dispatch(name,input);},{name,input});
const editor=(page,itemId)=>page.locator(`[data-checklist-editor="${itemId}"] .markdown-editor`);
const textEditor=(page,blockId)=>page.locator(`[data-text-editor="${blockId}"] .markdown-editor`);
const text=(page,{blockId,itemId,pageId})=>page.evaluate(async({blockId,itemId,pageId})=>{
  const {block}=lifecycleModel.findBlock(await lifecycleStore.getPage(pageId),blockId);
  return itemId?lifecycleModel.findChecklistItem(block.items,itemId).item.text:block.text;
},{blockId,itemId,pageId});
async function fixture(page,{toggle=false,type='checklist'}={}) {
  const pageId=(await call(page,'page_add',{title:'Markdown draft safety'})).pageId;
  const containerId=toggle?(await call(page,'add_block',{type:'toggle',title:'Shared project'})).blockId:undefined;
  const blockId=(await call(page,'add_block',{type,containerId,text:'Saved note',title:'Shared tasks'})).blockId;
  const itemId=type==='checklist'?(await call(page,'checklist_add',{blockId,text:'Saved task'})).itemId:undefined;
  return {pageId,containerId,blockId,itemId};
}
async function failWrites(page,blockId) {
  await page.evaluate(blockId=>{
    const put=IDBObjectStore.prototype.put;window.restoreLifecyclePut=()=>{IDBObjectStore.prototype.put=put;};
    IDBObjectStore.prototype.put=function(value,...args){if(this.name==='records'&&value?.data?.id===blockId)throw new Error('Injected Markdown draft storage failure');return put.call(this,value,...args);};
  },blockId);
}
const restoreWrites=page=>page.evaluate(()=>restoreLifecyclePut());
const flush=page=>page.evaluate(()=>lifecycleApp.flushPending());
const screenshot=(page,name)=>page.screenshot({path:`${root}/test-results/editor-lifecycle-${engine}-${basePath?'project':'root'}-${name}.png`,fullPage:true});

async function historyBarrier() {
  const {context,page}=await fresh(),f=await fixture(page),table=(await call(page,'add_block',{type:'table',rowCount:1,columnCount:1})).blockId;
  await call(page,'add_block',{type:'divider'});await page.evaluate(()=>lifecycleStore.undo());
  const before=await page.evaluate(()=>lifecycleStore.getRevision());
  await failWrites(page,table);await page.locator(`[data-block-id="${table}"] .table-cell`).fill('Table draft must precede history');
  await page.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');
  for(const key of ['Control+z','Control+Shift+z']) {
    const notices=await page.locator('#notices .notice').count();await editor(page,f.itemId).press(key);
    await page.waitForFunction(count=>document.querySelectorAll('#notices .notice').length>count,notices);
    assert.equal(await page.evaluate(()=>lifecycleStore.getRevision()),before);
    assert.equal(await page.locator(`[data-block-id="${table}"]`).count(),1);
    assert.equal(await page.evaluate(()=>lifecycleStore.canRedo()),true);
  }
  await restoreWrites(page);await flush(page);
  assert.equal(await page.evaluate(table=>lifecycleModel.findBlock(lifecycleStore.getState(),table).block.rows[0].cells[0],table),'Table draft must precede history');
  await editor(page,f.itemId).press('Control+z');await page.waitForFunction(table=>lifecycleModel.findBlock(lifecycleStore.getState(),table).block.rows[0].cells[0]==='',table);
  await editor(page,f.itemId).press('Control+Shift+z');await page.waitForFunction(table=>lifecycleModel.findBlock(lifecycleStore.getState(),table).block.rows[0].cells[0]==='Table draft must precede history',table);
  await context.close();
}

try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  await mkdir(`${root}/test-results`,{recursive:true});browser=await ({chromium,webkit}[engine]).launch({headless:true});
  await historyBarrier();assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: rich-editor undo/redo honors failed table drafts.`);
} finally {await browser?.close();server.kill();}
