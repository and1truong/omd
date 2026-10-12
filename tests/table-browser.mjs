import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'';
const url=`http://localhost:4323${base}/`,source=new URL('src/',url).href;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4323',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser,page,id;const errors=[];
const ready=async()=>{page.on('pageerror',e=>errors.push(e.message));await page.goto(url);await page.evaluate(async source=>{window.tableApp=await import(`${source}app.js`);await tableApp.ready;},source);};
const call=(name,input={})=>page.evaluate(async({name,input})=>{const store=tableApp.getStore();await tableApp.flushPending();return name==='undo'?store.undo():name==='redo'?store.redo():store.dispatch(name,input);},{name,input});
const grid=()=>page.evaluate(async({id,source})=>{const store=tableApp.getStore();await store.idle();return (await import(`${source}model.js`)).findBlock(store.getState(),id,'table').block;},{id,source});
const block=()=>page.locator(`[data-block-id="${id}"]`),cell=(r,c)=>block().getByRole('textbox',{name:`Table row ${r}, column ${c}`,exact:true});
const menu=async(axis,index)=>{await block().getByRole('button',{name:`${axis} ${index} actions`,exact:true}).click();return page.locator('#block-actions-dialog');};
const focus=async(r,c)=>assert.equal(await cell(r,c).evaluate(el=>el===document.activeElement),true);
const settled=()=>page.evaluate(async()=>{await tableApp.flushPending();});
const shape=async(rows,columns)=>{await page.waitForFunction(({id,rows,columns})=>{const block=document.querySelector(`[data-block-id="${id}"]`);return block?.querySelectorAll('.table-cell').length===rows*columns&&block.querySelector('.table-toolbar span')?.textContent===`${rows} rows × ${columns} columns`;},{id,rows,columns});};
const shot=async(name)=>page.screenshot({path:`${root}/test-results/table-${engine}-${base?'omd':'root'}-${name}.png`});
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  browser=await({chromium,webkit}[engine]).launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});context.setDefaultTimeout(10000);page=await context.newPage();await ready();
  await call('page_add',{title:'Bảng kế hoạch'});await call('set_page',{subtitle:'Hàng/cột, ghi chú và tiến độ'});
  // Primary creation is through the actual add-block UI, not a model fixture.
  await page.locator('[data-container="page"] > .add-block-button').click();await page.getByRole('button',{name:'Add table',exact:true}).click();
  await page.locator('.block-type-table').waitFor();id=await page.locator('.block-type-table').getAttribute('data-block-id');await shape(3,3);
  await block().getByRole('textbox',{name:'table title',exact:true}).fill('Kế hoạch tuần');
  const values=[['Công việc','Phụ trách','Ghi chú'],['Viết tài liệu','Hồng','Tiếng Việt / 日本語'],['Kiểm thử','Devin','<script>plain text</script>']];
  for(let r=0;r<3;r++)for(let c=0;c<3;c++)await cell(r+1,c+1).fill(values[r][c]);await settled();assert.deepEqual((await grid()).rows.map(r=>r.cells),values);
  await cell(2,1).click();await cell(2,1).press('Tab');await focus(2,2);await cell(2,2).press('Shift+Tab');await focus(2,1);await cell(2,1).press('Enter');await focus(3,1);await cell(3,1).press('Control+ArrowRight');await focus(3,2);await cell(3,2).press('Shift+Enter');await settled();assert.equal((await grid()).rows[2].cells[1],'Devin\n');
  // Explicit before/after positions preserve every untouched cell and identity.
  const original=await grid();await (await menu('Row',2)).getByRole('button',{name:'Insert row below',exact:true}).click();await shape(4,3);await focus(3,1);
  assert.deepEqual((await grid()).rows.map(r=>r.id),[original.rows[0].id,original.rows[1].id,(await grid()).rows[2].id,original.rows[2].id]);
  await cell(3,1).fill('Hàng mới');await (await menu('Column',2)).getByRole('button',{name:'Insert column before',exact:true}).click();await shape(4,4);await focus(1,2);
  assert.equal((await grid()).rows[1].cells[2],'Hồng');await cell(2,2).fill('Cột mới');
  await (await menu('Row',3)).getByRole('button',{name:'Delete row',exact:true}).click();await page.locator('#confirm-cancel').click();assert.equal((await grid()).rows.length,4);
  await (await menu('Row',3)).getByRole('button',{name:'Delete row',exact:true}).click();await page.locator('#confirm-ok').click();await shape(3,4);await focus(3,1);await call('undo');await shape(4,4);assert.equal((await grid()).rows[2].cells[0],'Hàng mới');await call('redo');await shape(3,4);await call('undo');await shape(4,4);
  await (await menu('Column',2)).getByRole('button',{name:'Delete column',exact:true}).click();await page.locator('#confirm-ok').click();await shape(4,3);await call('undo');await shape(4,4);assert.equal((await grid()).rows[1].cells[1],'Cột mới');
  await (await menu('Row',1)).getByRole('button',{name:'Insert row above',exact:true}).click();await shape(5,4);await call('undo');await shape(4,4);
  await (await menu('Column',4)).getByRole('button',{name:'Insert column after',exact:true}).click();await shape(4,5);await call('undo');await shape(4,4);
  await block().getByRole('button',{name:'Add table row',exact:true}).click();await shape(5,4);await block().getByRole('button',{name:'Add table column',exact:true}).click();await shape(5,5);await call('undo');await call('undo');await shape(4,4);
  // Synthetic composition regression only: not an actual OS IME test.
  await cell(2,1).evaluate(el=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Tiếng Việt 日本語';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true,isComposing:true}));});await focus(2,1);
  assert.equal((await grid()).rows[1].cells[0],'Viết tài liệu');await cell(2,1).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'Tiếng Việt 日本語'})));await settled();assert.equal((await grid()).rows[1].cells[0],'Tiếng Việt 日本語');
  // Failed actual IndexedDB writes retain the draft; navigation is prevented until retry.
  const current=await page.evaluate(()=>tableApp.getStore().getActivePageId()),other=(await call('page_add',{title:'Other page'})).pageId;await call('page_select',{pageId:current});
  await page.evaluate(()=>{window.tablePut=IDBObjectStore.prototype.put;const name=tableApp.getStore().databaseName();IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===name)throw new DOMException('Table quota test','QuotaExceededError');return tablePut.apply(this,args);};});
  await cell(2,1).fill('Bản nháp còn nguyên');await page.locator('.notice.error').filter({hasText:'Table quota test'}).first().waitFor();
  await page.evaluate(async()=>{try{await tableApp.setView({sidebarOpen:true});}catch{}});assert.equal(await cell(2,1).inputValue(),'Bản nháp còn nguyên');assert.equal(await page.evaluate(()=>tableApp.getStore().getActivePageId()),current);assert.notEqual((await grid()).rows[1].cells[0],'Bản nháp còn nguyên');
  await page.evaluate(()=>{IDBObjectStore.prototype.put=tablePut;});await settled();assert.equal((await grid()).rows[1].cells[0],'Bản nháp còn nguyên');
  for(const notice of await page.locator('.notice.error button').all())await notice.click();
  // Navigation through the real palette waits for the final composing cell and its captured page.
  await page.evaluate(()=>tableApp.openPalette());await page.locator('#page-search').fill('Other page');
  await cell(2,1).evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='最後の文字';});
  await page.locator('#palette-pages').getByRole('option',{name:'Other page',exact:true}).evaluate(el=>el.click());assert.equal(await page.evaluate(()=>tableApp.getStore().getActivePageId()),current);
  await cell(2,1).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'最後の文字'})));
  await page.waitForFunction(other=>tableApp.getStore().getActivePageId()===other,other);await call('page_select',{pageId:current});assert.equal((await grid()).rows[1].cells[0],'最後の文字');
  // Header semantics and pin configuration are persisted, not merely CSS state.
  assert.equal(await block().locator('.table-options-panel:visible').count(),0);assert.equal(await block().locator('.table-column-tools').count(),0);
  await block().locator('.table-options summary').click();assert.equal(await block().getByRole('checkbox',{name:'Pin header',exact:true}).isEnabled(),true);
  await block().getByRole('checkbox',{name:'Header row',exact:true}).uncheck();await settled();assert.equal(await block().locator('.table-header').count(),0);assert.equal(await block().getByRole('checkbox',{name:'Pin header',exact:true}).isEnabled(),false);await block().getByRole('checkbox',{name:'Header row',exact:true}).check();await settled();
  await block().getByRole('combobox',{name:'Pinned first columns',exact:true}).selectOption('2');await settled();assert.equal((await grid()).pinnedColumns,2);
  await block().locator('.table-options summary').click();
  await (await menu('Column',2)).getByRole('button',{name:'Unpin columns',exact:true}).click();await settled();assert.equal((await grid()).pinnedColumns,0);
  await (await menu('Column',2)).getByRole('button',{name:'Pin columns up to column 2',exact:true}).click();await settled();assert.equal((await grid()).pinnedColumns,2);
  await (await menu('Row',1)).getByRole('button',{name:'Unpin header row',exact:true}).click();await settled();assert.equal((await grid()).pinnedHeader,false);assert.equal(await block().locator('.table-header-pinned').count(),0);
  await (await menu('Row',1)).getByRole('button',{name:'Pin header row',exact:true}).click();await settled();assert.equal((await grid()).pinnedHeader,true);
  await mkdir(`${root}/test-results`,{recursive:true});await page.evaluate(async()=>await tableApp.setView({theme:'light',contentWidth:'reading',sidebarOpen:false}));await shot('light');
  await page.evaluate(async()=>await tableApp.setView({theme:'dark',contentWidth:'wide'}));await shot('dark');
  await page.emulateMedia({colorScheme:'dark'});await page.evaluate(async()=>await tableApp.setView({theme:'system'}));await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
  const saved=await grid();await page.reload();await page.evaluate(async source=>{window.tableApp=await import(`${source}app.js`);await tableApp.ready;},source);assert.deepEqual(await grid(),saved);
  // JSON export/import through the actual UI including confirmation and backup.
  await page.locator('#page-menu summary').click();const downloadEvent=page.waitForEvent('download');await page.locator('#export-button').click();const download=await downloadEvent,json=await readFile(await download.path(),'utf8');
  await cell(2,1).fill('Changed after backup');await settled();await page.locator('#import-file').setInputFiles({name:'tables.json',mimeType:'application/json',buffer:Buffer.from(json)});await page.locator('#confirm-ok').click();await page.locator('.notice').filter({hasText:'Notebook imported.'}).waitFor();assert.deepEqual(await grid(),saved);
  await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);await cell(2,1).fill('Offline table');await settled();
  // Playwright WebKit's offline navigation fails internally even with an active SW.
  // Still verify disconnected IndexedDB writes there; Chromium covers offline boot.
  if(engine==='webkit')await context.setOffline(false);
  await page.reload();await page.evaluate(async source=>{window.tableApp=await import(`${source}app.js`);await tableApp.ready;},source);assert.equal((await grid()).rows[1].cells[0],'Offline table');await context.setOffline(false);
  // Hidden tab/toggle/accordion branches do not mount cell editors.
  const tabs=(await call('add_block',{type:'tabs'})).block,toggle=(await call('add_block',{type:'toggle',containerId:tabs.tabs[1].id})).block,accordion=(await call('add_block',{type:'accordion',containerId:toggle.id})).block;
  const nested=(await call('add_block',{type:'table',containerId:accordion.items[0].id})).blockId;assert.equal(await page.locator(`[data-block-id="${nested}"]`).count(),0);
  await call('tab_select',{blockId:tabs.id,tabId:tabs.tabs[1].id});await page.locator(`[data-block-id="${nested}"]`).waitFor();
  await call('update_block',{blockId:toggle.id,patch:{open:false}});assert.equal(await page.locator(`[data-block-id="${nested}"]`).count(),0);await call('update_block',{blockId:toggle.id,patch:{open:true}});
  await call('accordion_update',{blockId:accordion.id,itemId:accordion.items[0].id,patch:{open:false}});assert.equal(await page.locator(`[data-block-id="${nested}"]`).count(),0);await call('accordion_update',{blockId:accordion.id,itemId:accordion.items[0].id,patch:{open:true}});
  await page.locator(`[data-block-id="${nested}"]`).getByRole('textbox',{name:'Table row 2, column 2',exact:true}).fill('Nested');await settled();await call('tab_select',{blockId:tabs.id,tabId:tabs.tabs[0].id});assert.equal(await page.locator(`[data-block-id="${nested}"]`).count(),0);await call('tab_select',{blockId:tabs.id,tabId:tabs.tabs[1].id});assert.equal(await page.locator(`[data-block-id="${nested}"]`).getByRole('textbox',{name:'Table row 2, column 2',exact:true}).inputValue(),'Nested');
  // Mobile wide/tall table: pinned header/first columns remain fixed in local scrolling.
  await page.setViewportSize({width:320,height:844});await page.evaluate(async()=>await tableApp.setView({contentWidth:'reading',sidebarOpen:false,theme:'light'}));
  for(let i=0;i<10;i++)await call('table_row_add',{blockId:id});for(let i=0;i<3;i++)await call('table_column_add',{blockId:id});await shape(14,7);
  await block().locator('.table-options summary').click();await block().getByRole('combobox',{name:'Pinned first columns',exact:true}).selectOption('1');await settled();await block().locator('.table-options summary').click();
  const pins=await block().locator('.table-scroll').evaluate(scroll=>{const header=scroll.querySelector('.table-header th'),first=scroll.querySelector('tbody tr td');scroll.scrollLeft=280;scroll.scrollTop=180;return {width:scroll.scrollWidth,client:scroll.clientWidth,headerTop:header.getBoundingClientRect().top,firstLeft:first.getBoundingClientRect().left,top:scroll.getBoundingClientRect().top,left:scroll.getBoundingClientRect().left};});
  assert.ok(pins.width>pins.client);assert.ok(Math.abs(pins.headerTop-pins.top)<=2);assert.ok(Math.abs(pins.firstLeft-pins.left)<=2);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Wide table must not overflow the whole page');await block().scrollIntoViewIfNeeded();await shot('mobile-pinned');
  // Arbitrary imported IDs must not collide when combined into DOM cell identity.
  await page.evaluate(async()=>{const store=tableApp.getStore(),book=JSON.parse(await store.export());book.pages.find(p=>p.id===store.getActivePageId()).blocks.push({id:'collision-table',type:'table',title:'Imported IDs',headerRow:true,pinnedHeader:true,pinnedColumns:0,columns:[{id:'c'},{id:'b-c'}],rows:[{id:'a-b',cells:['one','two']},{id:'a',cells:['three','four']}]});await store.import(JSON.stringify(book));});
  const imported=page.locator('[data-block-id="collision-table"]'),ids=await imported.locator('.table-cell').evaluateAll(cells=>cells.map(c=>c.id));assert.equal(new Set(ids).size,4);
  await imported.getByRole('textbox',{name:'Table row 1, column 1',exact:true}).click();await page.keyboard.press('Tab');assert.equal(await imported.getByRole('textbox',{name:'Table row 1, column 2',exact:true}).evaluate(el=>el===document.activeElement),true);
  await context.close();assert.deepEqual(errors,[]);console.log(`${engine} ${base||'/'}: table UI, keyboard, dimensions, pinning, synthetic composition, failure/retry, nested visibility, JSON, reload, disconnected writes and mobile passed. Offline boot: ${engine==='webkit'?'not tested (Playwright internal navigation error)':'passed'}.`);
}finally{await browser?.close();server.kill();}
