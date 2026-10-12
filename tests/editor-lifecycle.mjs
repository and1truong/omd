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

async function retainedDrafts(type) {
  const {context,page}=await fresh(),f=await fixture(page,{toggle:true,type}),input=f.itemId?editor(page,f.itemId):textEditor(page,f.blockId),draft=`Retained ${type} draft tiếng Việt`;
  await input.evaluate(el=>{window.retainedEditor=el.editor;});await failWrites(page,f.blockId);await input.fill(draft);
  await page.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');
  const peer=await context.newPage();await ready(peer);await call(peer,'page_select',{pageId:f.pageId});
  await call(peer,'update_block',{blockId:f.containerId,patch:{open:false}});await input.waitFor({state:'detached'});
  assert.equal(await page.evaluate(()=>retainedEditor.isDestroyed),false);
  await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).inputValue(),draft);
  assert.equal(await page.locator('#save-status').innerText(),'Not saved');await assert.rejects(()=>flush(page),/Injected Markdown draft storage failure/);
  await screenshot(page,`${type}-retained`);await restoreWrites(page);
  await page.getByRole('button',{name:'Retry Markdown draft save',exact:true}).click();
  await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).waitFor({state:'detached'});
  assert.equal(await text(page,f),draft);assert.equal(await page.locator('#save-status').innerText(),'Saved');
  assert.equal(await page.evaluate(()=>retainedEditor.isDestroyed),true);
  await call(page,'update_block',{blockId:f.containerId,patch:{open:true}});assert.equal(await input.innerText(),draft);
  await failWrites(page,f.blockId);await input.fill(`${draft} after reopening`);await page.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');
  await page.evaluate(()=>lifecycleStore.dispatch('page_add',{title:'Direct navigation retains draft'}));
  await input.waitFor({state:'detached'});assert.equal(await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).inputValue(),`${draft} after reopening`);
  await restoreWrites(page);await flush(page);assert.equal(await text(page,f),`${draft} after reopening`);
  await context.close();
}

async function deletedDrafts(removePage=false) {
  const {context,page}=await fresh(),f=await fixture(page),draft=removePage?'Draft from deleted page':'Draft from deleted checklist';
  await failWrites(page,f.blockId);await editor(page,f.itemId).fill(draft);await page.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');
  const peer=await context.newPage();await ready(peer);await call(peer,'page_select',{pageId:f.pageId});
  await call(peer,removePage?'page_remove':'remove_block',removePage?{pageId:f.pageId}:{blockId:f.blockId});
  await editor(page,f.itemId).waitFor({state:'detached'});await restoreWrites(page);
  await assert.rejects(()=>flush(page),/not found/i);assert.equal(await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).inputValue(),draft);
  const downloadEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download unsaved Markdown draft',exact:true}).click();
  const download=await downloadEvent,stream=await download.createReadStream();assert.equal(Buffer.concat(await stream.toArray()).toString(),draft);
  assert.equal(await page.locator('#save-status').innerText(),'Not saved');
  await page.getByRole('button',{name:'Recover Markdown draft as a new note',exact:true}).click();await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).waitFor({state:'detached'});
  assert.equal(await page.evaluate(draft=>lifecycleStore.getState().blocks.filter(block=>block.type==='text'&&block.text===draft).length,draft),1);
  await flush(page);await screenshot(page,removePage?'page-recovered':'checklist-recovered');
  await page.reload();await page.evaluate(async()=>{await (await import(new URL('./src/app.js',document.baseURI).href)).ready;});
  assert.equal(await page.locator('[data-text-editor] .markdown-editor').filter({hasText:draft}).count(),1);
  await context.close();
}

async function composed(page,input,text) {
  await input.evaluate((el,text)=>{
    el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    el.replaceChildren(Object.assign(document.createElement('p'),{textContent:text}));el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
  },text);
}
async function compositionBarrier(type) {
  const {context,page}=await fresh(),f=await fixture(page,{type}),input=f.itemId?editor(page,f.itemId):textEditor(page,f.blockId),draft=`Tiếng Việt 漢字 ${type}`;
  await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  await page.waitForFunction(({itemId,blockId})=>!document.querySelector(itemId?`[data-checklist-editor="${itemId}"] .markdown-editor`:`[data-text-editor="${blockId}"] .markdown-editor`).editor.view.composing,f);
  assert.equal(await page.locator('#save-status').innerText(),'Saved');
  await composed(page,input,draft);
  await page.evaluate(()=>{window.exportFinished=false;window.strictExport=lifecycleApp.downloadJson().then(()=>{window.exportFinished=true;});});
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>exportFinished),false);
  const downloadEvent=page.waitForEvent('download');await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await page.evaluate(()=>strictExport);const download=await downloadEvent,stream=await download.createReadStream(),book=JSON.parse(Buffer.concat(await stream.toArray()).toString());
  const block=book.pages.find(p=>p.id===f.pageId).blocks[0];assert.equal(f.itemId?block.items[0].text:block.text,draft);
  await composed(page,input,`${draft} final`);
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await flush(page);assert.equal(await text(page,f),`${draft} final`);
  await page.waitForFunction(({itemId,blockId})=>!document.querySelector(itemId?`[data-checklist-editor="${itemId}"] .markdown-editor`:`[data-text-editor="${blockId}"] .markdown-editor`).editor.view.composing,f);
  await composed(page,input,`${draft} pending write`);
  await page.evaluate(({blockId,itemId})=>{
    const dispatch=lifecycleStore.dispatch;window.restoreCompositionDispatch=()=>{lifecycleStore.dispatch=dispatch;};
    lifecycleStore.dispatch=async(name,input,options)=>{
      if(input.blockId===blockId&&(itemId?name==='checklist_update':name==='update_block')&&input.patch?.text?.endsWith('pending write')){
        window.finalWriteStarted=true;await new Promise(resolve=>{window.finishCompositionWrite=resolve;});
      }return dispatch(name,input,options);
    };
  },f);
  await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await page.waitForFunction(()=>window.finalWriteStarted);
  await page.evaluate(()=>{window.strictFlushFinished=false;window.strictFlush=lifecycleApp.flushPending().then(()=>{window.strictFlushFinished=true;});});
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>strictFlushFinished),false);
  await input.evaluate(el=>el.editor.chain().setTextSelection(el.editor.state.doc.content.size-1).insertContent(' tiếp').run());
  await page.evaluate(()=>{restoreCompositionDispatch();finishCompositionWrite();});await page.evaluate(()=>strictFlush);
  assert.equal(await text(page,f),`${draft} pending write tiếp`);
  await page.waitForFunction(({itemId,blockId})=>!document.querySelector(itemId?`[data-checklist-editor="${itemId}"] .markdown-editor`:`[data-text-editor="${blockId}"] .markdown-editor`).editor.view.composing,f);
  await composed(page,input,`${draft} on original page`);await input.evaluate(el=>{window.originalComposingEditor=el;});
  const next=(await page.evaluate(()=>lifecycleStore.dispatch('page_add',{title:'Composition navigation destination'}))).pageId;
  await page.waitForFunction(pageId=>lifecycleStore.getActivePageId()===pageId,next);assert.equal(await page.evaluate(()=>originalComposingEditor.isConnected),true);
  await page.evaluate(()=>originalComposingEditor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await flush(page);
  assert.equal(await text(page,f),`${draft} on original page`);assert.equal(await page.evaluate(()=>lifecycleStore.getActivePageId()),next);
  await context.close();
}

async function importedFocus() {
  const {context,page}=await fresh(),f=await fixture(page);
  await page.evaluate(async f=>{
    const book=JSON.parse(await lifecycleStore.export()),block=book.pages.find(p=>p.id===f.pageId).blocks[0];
    block.items=[{id:'first-root-item',text:'First task',done:false},{id:'page-title',text:'Imported task',done:false}];await lifecycleStore.import(JSON.stringify(book));
  },f);
  const input=editor(page,'page-title'),focus=()=>page.waitForFunction(()=>document.activeElement?.closest('[data-checklist-editor]')?.dataset.checklistEditor==='page-title');
  const editorId=await input.getAttribute('id');assert.notEqual(editorId,'page-title');assert.equal(await page.locator('[id="page-title"]').count(),1);
  await input.press('Tab');await page.waitForFunction(()=>lifecycleStore.getState().blocks[0].items[0].children?.[0]?.id==='page-title');await focus();
  assert.equal(await input.getAttribute('id'),editorId);
  await page.evaluate(()=>{
    const raf=requestAnimationFrame;window.pendingChecklistFocus=null;
    window.requestAnimationFrame=function(callback){
      if(String(callback).includes('revealChecklistItem(target)')){
        window.pendingChecklistFocus=()=>{window.requestAnimationFrame=raf;callback(performance.now());};return 0;
      }
      return raf.call(this,callback);
    };
  });
  await input.press('Shift+Tab');await page.waitForFunction(()=>lifecycleStore.getState().blocks[0].items[1]?.id==='page-title'&&!!window.pendingChecklistFocus);
  const {before,after,wouldReset}=await input.evaluate(el=>{
    el.focus();el.editor.commands.setTextSelection(1);
    const node=el.querySelector('p').firstChild,range=document.createRange(),selection=getSelection();
    range.setStart(node,node.length);range.collapse(true);selection.removeAllRanges();selection.addRange(range);
    const before=selection.anchorOffset;
    el.editor.view.focus();const wouldReset=selection.anchorOffset===0;
    selection.removeAllRanges();selection.addRange(range);window.pendingChecklistFocus();
    return {before,after:selection.anchorOffset,wouldReset};
  });
  assert.equal(before,'Imported task'.length);assert.equal(wouldReset,true);assert.equal(after,before);
  await focus();const title=await page.locator('#page-title').inputValue();await page.keyboard.type(' stays focused');await flush(page);
  assert.equal(await page.locator('#page-title').inputValue(),title);assert.equal(await text(page,{...f,itemId:'page-title'}),'Imported task stays focused');
  await page.locator('[data-item-id="page-title"] > .check-row').getByRole('button',{name:'Checklist item actions',exact:true}).click();
  await page.locator('#block-actions-dialog').getByRole('button',{name:'Move checklist item up',exact:true}).click();
  await page.waitForFunction(()=>lifecycleStore.getState().blocks[0].items[0]?.id==='page-title');await focus();
  await input.press('Enter');await page.waitForFunction(()=>lifecycleStore.getState().blocks[0].items.length===3);
  const added=await page.evaluate(()=>lifecycleStore.getState().blocks[0].items[1].id);
  await page.waitForFunction(id=>document.activeElement?.closest('[data-checklist-editor]')?.dataset.checklistEditor===id,added);
  await screenshot(page,'imported-focus');await context.close();
}

async function scopedSettlement() {
  const {context,page}=await fresh();await page.evaluate(async()=>{
    const {createCompositionGuard}=await import(new URL('./src/composition.js',document.baseURI).href),{createTextEditors}=await import(new URL('./src/text-editors.js',document.baseURI).href);
    const guard=createCompositionGuard(),native=document.createElement('textarea');document.body.append(native);guard.track(native,()=>{},()=>lifecycleStore.getActivePageId());
    const manager=createTextEditors(lifecycleStore,{composition:guard,notify:()=>{},createNext:async()=>{},flushPending:async()=>{}});
    const host=manager.mount({id:'scoped-test-editor',type:'text',text:'Unrelated composition'},lifecycleStore.getActivePageId());document.body.append(host);
    native.dispatchEvent(new CompositionEvent('compositionstart'));await manager.flushAll();assertNativeStillComposing();
    function assertNativeStillComposing(){if(!guard.isComposing(native))throw new Error('Native composition was incorrectly ended');}
    native.dispatchEvent(new CompositionEvent('compositionend'));await guard.settled();manager.destroy();host.remove();native.remove();
  });await context.close();
}

async function composingDeletion() {
  const {context,page}=await fresh(),f=await fixture(page),input=editor(page,f.itemId),draft='漢字 còn giữ sau khi xóa từ tab khác';
  await composed(page,input,draft);const peer=await context.newPage();await ready(peer);await call(peer,'page_select',{pageId:f.pageId});await call(peer,'remove_block',{blockId:f.blockId});
  await page.waitForFunction(blockId=>!lifecycleStore.getState().blocks.some(block=>block.id===blockId),f.blockId);
  assert.equal(await input.count(),1);await input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await input.waitFor({state:'detached'});assert.equal(await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).inputValue(),draft);
  await page.getByRole('button',{name:'Recover Markdown draft as a new note',exact:true}).click();await page.getByRole('textbox',{name:'Unsaved Markdown draft',exact:true}).waitFor({state:'detached'});
  assert.equal(await page.evaluate(draft=>lifecycleStore.getState().blocks.at(-1).text,draft),draft);await context.close();
}

try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  await mkdir(`${root}/test-results`,{recursive:true});browser=await ({chromium,webkit}[engine]).launch({headless:true});
  await historyBarrier();await retainedDrafts('checklist');await retainedDrafts('text');await deletedDrafts();await deletedDrafts(true);
  await compositionBarrier('checklist');await compositionBarrier('text');await importedFocus();await scopedSettlement();await composingDeletion();assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: history/draft recovery, strict scoped composition/export, original-page navigation and imported focus identity passed.`);
} finally {await browser?.close();server.kill();}
