import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4323${basePath}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4323',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser,page;const errors=[];
const ready=()=>page.evaluate(async()=>{window.tabsApp=await import(new URL('./src/app.js',document.baseURI).href);await window.tabsApp.ready;});
const call=(name,input={})=>page.evaluate(async({name,input})=>window.tabsApp.getStore().dispatch(name,input),{name,input});
const settled=()=>page.evaluate(async()=>{await window.tabsApp.flushPending();await window.tabsApp.getStore().idle();});
const state=()=>page.evaluate(async()=>window.tabsApp.getStore().getPage());
const revision=()=>page.evaluate(()=>window.tabsApp.getStore().getRevision());
function find(blocks,id){for(const block of blocks){if(block.id===id)return block;const child=find(block.blocks??block.tabs?.flatMap(t=>t.blocks)??[],id);if(child)return child;}}
const block=async id=>find((await state()).blocks,id);
const header=id=>page.locator(`[id="${id}-button"]`);
const tablist=id=>page.locator(`[data-block-id="${id}"] > .tab-group > .tabs-layout > .tablist`);
const own=id=>page.locator(`[data-block-id="${id}"] > .tab-group > .tabs-layout > .tab-panel > .tab-editbar`);
const focused=id=>page.waitForFunction(id=>document.activeElement?.id===`${id}-button`,id);
const screenshot=name=>page.screenshot({path:`${root}/test-results/tabs-drag-${engine}-${basePath?'project':'root'}-${name}.png`,fullPage:true});

async function startDrag(source,target,side='center') {
  await source.scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();
  const a=await source.boundingBox(),b=await target.boundingBox();assert.ok(a&&b);
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(a.x+a.width/2+10,a.y+a.height/2);
  const x=b.x+b.width*(side==='before-x'?.2:side==='after-x'?.8:.5),y=b.y+b.height*(side==='before-y'?.2:side==='after-y'?.8:.5);
  await page.mouse.move(x,y,{steps:12});await page.mouse.move(x,y);
}
async function drag(source,target,side='center') {await startDrag(source,target,side);await page.mouse.up();await settled();}
async function blockDrag(source,target) {
  await startDrag(source,target);const rect=await target.boundingBox();await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);await page.mouse.up();await settled();
}
async function reorder(id,source,target,after,orientation,proof) {
  await startDrag(header(source),header(target).locator('..'),`${after?'after':'before'}-${orientation==='horizontal'?'x':'y'}`);
  assert.equal(await tablist(id).locator('.tab-drop-before,.tab-drop-after').count(),1,'native dragover exposes an insertion marker');
  if(proof)await screenshot(proof);
  await page.mouse.up();await settled();
  assert.equal(await page.locator('.dragging,.tab-drop-before,.tab-drop-after').count(),0);
}
async function group(orientation,containerId,title) {
  const id=(await call('add_block',{type:'tabs',orientation,title,...(containerId?{containerId}:{})})).blockId;
  for(const title of ['Third tab','Fourth tab'])await call('tab_add',{blockId:id,title});
  const tabs=(await block(id)).tabs,texts=[];
  for(const [i,t]of tabs.entries()){
    await call('tab_update',{blockId:id,tabId:t.id,title:`${title} ${['Alpha','Bravo','Charlie','Delta'][i]}`});
    texts.push((await call('add_block',{type:'text',containerId:t.id,text:`Content ${i+1} stays with its ID.`})).blockId);
  }
  await call('tab_select',{blockId:id,tabId:tabs[0].id});return {id,ids:tabs.map(t=>t.id),texts};
}
async function unchanged(operation) {await settled();const before=await revision();await operation();await settled();assert.equal(await revision(),before,'cancelled, invalid and no-op drags must not enter history');}
const titleInput=()=>page.getByRole('textbox',{name:'Rename tab',exact:true});
const titleOf=async(group,id)=>(await block(group.id)).tabs.find(t=>t.id===id).title;
async function inlineRename(group,nested,orientation) {
  const active=(await block(group.id)).activeTabId,id=group.ids.find(id=>id!==active&&id!==group.ids[0]),old=await titleOf(group,id);
  assert.equal(await page.locator('.tab-editbar input').count(),0,'no duplicate label field');
  const before=await revision(),history=await page.evaluate(()=>window.tabsApp.getStore().residency().undoEntries);
  await header(id).press('F2');await titleInput().fill(`Inline ${orientation}`);
  assert.equal(await titleInput().evaluate(el=>el.closest('button')),null,'native input is a sibling, not nested in a tab button');
  assert.equal(await tablist(group.id).getByRole('tab').count(),4,'editing retains the tab role and selection semantics');
  await titleInput().press('Home');await titleInput().press('Shift+End');assert.equal(await page.locator('.dragging').count(),0);
  await titleInput().press('Enter');await settled();await focused(id);
  assert.equal(await titleOf(group,id),`Inline ${orientation}`);assert.equal((await block(group.id)).activeTabId,active);assert.equal(await titleInput().count(),0);
  assert.equal(await revision(),before+1);assert.equal(await page.evaluate(()=>window.tabsApp.getStore().residency().undoEntries),history+1);
  await page.locator('#undo-button').click();await settled();assert.equal(await titleOf(group,id),old);
  const noOpRevision=await revision(),noOpHistory=await page.evaluate(()=>window.tabsApp.getStore().residency().undoEntries);await header(active).click();await settled();
  assert.equal(await revision(),noOpRevision);assert.equal(await page.evaluate(()=>window.tabsApp.getStore().residency().undoEntries),noOpHistory);assert.equal(await page.evaluate(()=>window.tabsApp.getStore().canRedo()),true);
  await page.locator('#redo-button').click();await settled();assert.equal(await titleOf(group,id),`Inline ${orientation}`);
  await header(id).press('F2');await titleInput().fill('Cancelled draft');await titleInput().press('Escape');await focused(id);
  assert.equal(await titleOf(group,id),`Inline ${orientation}`);assert.equal(await revision(),before+3);
  // A pointer gesture and blur commit operate on the label itself.
  const activeTitle=await titleOf(group,active);
  await header(active).dblclick();await titleInput().fill('Blurred title');await page.locator('#page-title').focus();await settled();assert.equal(await titleOf(group,active),'Blurred title');
  await header(active).press('F2');await titleInput().fill(activeTitle);await titleInput().press('Enter');await settled();
  await header(id).press('F2');await titleInput().fill('');await titleInput().press('Enter');await settled();assert.equal(await header(id).innerText(),'Untitled');
  await header(id).press('F2');assert.equal(await titleInput().inputValue(),'');await titleInput().press('Escape');
  // Enter while Vietnamese/CJK composition is active never closes or persists a partial title.
  await header(id).press('F2');const imeBefore=await revision();
  await titleInput().evaluate(el=>{window.inlineIME=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Tiếng Việt 世界';});
  await titleInput().press('Enter');assert.equal(await revision(),imeBefore);assert.equal(await titleInput().isVisible(),true);
  await titleInput().evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await page.evaluate(()=>new Promise(requestAnimationFrame));
  assert.equal(await titleInput().isVisible(),true);await titleInput().press('Enter');await settled();assert.equal(await titleOf(group,id),'Tiếng Việt 世界');assert.equal(await revision(),imeBefore+1);
  // Save failure keeps the draft available for retry and does not create an undo entry.
  await header(id).press('F2');await titleInput().fill('Retry this title');const failureBefore=await revision();
  await page.evaluate(()=>{const store=window.tabsApp.getStore();window.realDispatch=store.dispatch;store.dispatch=(name,...args)=>name==='tab_update'?Promise.reject(new Error('Injected tab save failure')):window.realDispatch(name,...args);});
  await titleInput().press('Enter');await page.getByText('Injected tab save failure',{exact:true}).waitFor();assert.equal(await titleInput().inputValue(),'Retry this title');assert.equal(await titleInput().isEnabled(),true);assert.equal(await revision(),failureBefore);
  await page.evaluate(()=>{window.tabsApp.getStore().dispatch=window.realDispatch;});await titleInput().press('Enter');await settled();assert.equal(await titleOf(group,id),'Retry this title');assert.equal(await revision(),failureBefore+1);
  await page.getByRole('button',{name:'Dismiss message'}).click();
  const nestedActive=(await block(nested.id)).activeTabId;
  if(active!==group.ids[0]){await header(group.ids[0]).click();await settled();}
  await header(nested.ids[1]).locator('..').getByRole('button',{name:/Rename/}).click();await titleInput().fill('Nested inline title');await titleInput().press('Enter');await settled();assert.equal((await block(nested.id)).activeTabId,nestedActive);assert.equal(await titleOf(nested,nested.ids[1]),'Nested inline title');
  await header(nested.ids[1]).press('F2');await titleInput().evaluate(el=>{window.hiddenInlineIME=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Nested composition kept';});
  await header(id).click();await settled();assert.equal(await page.evaluate(()=>window.hiddenInlineIME.isConnected),true);
  await page.evaluate(()=>window.hiddenInlineIME.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await settled();assert.equal(await titleOf(nested,nested.ids[1]),'Nested composition kept');
  await header(group.ids[0]).click();await settled();
  if(active!==group.ids[0]){await header(active).click();await settled();}
  // Navigation captures the original page/tab even when composition settles on another route.
  const sourcePage=(await state()).id,destinationPage=(await call('page_add',{title:`Inline destination ${orientation}`})).pageId;
  await call('page_select',{pageId:sourcePage});await page.evaluate(()=>window.tabsApp.setView({sidebarOpen:true}));
  await header(id).press('F2');await titleInput().evaluate(el=>{window.pageInlineIME=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Saved to original page';});
  await page.getByRole('link',{name:`Switch to Inline destination ${orientation}`,exact:true}).click();await settled();assert.equal((await state()).id,destinationPage);assert.equal(await page.evaluate(()=>window.pageInlineIME.isConnected),true);
  await page.evaluate(()=>window.pageInlineIME.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await settled();
  const originalPage=await page.evaluate(pageId=>window.tabsApp.getStore().getPage(pageId),sourcePage);
  assert.equal(originalPage.blocks.find(b=>b.id===group.id).tabs.find(t=>t.id===id).title,'Saved to original page');assert.equal((await state()).blocks.length,0);
  await page.locator(`#sidebar-pages [data-page-id="${sourcePage}"]`).getByRole('link').first().click();await settled();await page.evaluate(()=>window.tabsApp.setView({sidebarOpen:false}));
  await header(id).press('F2');await titleInput().fill('Retry this title');await titleInput().press('Enter');await settled();
  const ids=(await block(group.id)).tabs.map(t=>t.id),after=ids[0]===id,destination=after?ids.at(-1):ids[0];
  await reorder(group.id,id,destination,after,orientation);assert.equal((await block(group.id)).activeTabId,active);assert.equal(await titleOf(group,id),'Retry this title');
  await screenshot(`${orientation}-inline-labels`);await header(id).press('F2');await screenshot(`${orientation}-inline-editing`);await titleInput().press('Escape');
  await page.reload();await ready();assert.equal(await titleOf(group,id),'Retry this title');
  console.log(`${engine} ${basePath||'/'}: ${orientation} inline labels, nested edits, Enter/Escape/blur, one-entry history, empty titles, IME hide/page switch, failure/retry and DnD after rename passed.`);
}

async function staleTabControls(orientation) {
  await call('page_add',{title:`Scope A ${orientation}`});const tabs=await group(orientation,null,'Same IDs');
  const source=await state(),destination={...structuredClone(source),id:`${source.id}-copy`,title:`Scope B ${orientation}`};
  const book=await page.evaluate(()=>window.tabsApp.getStore().getNotebook());book.pages=[source,destination];book.activePageId=source.id;book.parents={[source.id]:'',[destination.id]:''};
  await call('import_notebook',{notebook:book});await settled();
  const baseline=structuredClone((await block(tabs.id)));await page.evaluate(()=>window.tabsApp.setView({sidebarOpen:true}));
  await header(tabs.ids[1]).press('F2');await page.getByRole('textbox',{name:'Rename tab',exact:true}).evaluate(el=>{window.scopedTitle=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Draft belongs to A';});
  await page.getByRole('link',{name:`Switch to ${destination.title}`,exact:true}).click();await settled();
  assert.equal((await state()).id,destination.id);assert.equal(await page.evaluate(()=>window.scopedTitle.isConnected),true);
  await own(tabs.id).getByRole('button',{name:'Move tab down',exact:true}).click();await settled();
  await header(tabs.ids[0]).press('End');await settled();
  await header(tabs.ids[2]).click();await settled();
  await tablist(tabs.id).getByRole('button',{name:'Add tab',exact:true}).click();await settled();
  await own(tabs.id).getByRole('button',{name:'Delete tab',exact:true}).click();await page.getByRole('button',{name:'Remove tab',exact:true}).click();await settled();
  assert.deepEqual(await block(tabs.id),baseline,'stale select/keyboard/add/move/remove never mutate the destination with identical IDs');
  assert.equal(await page.evaluate(()=>window.scopedTitle.isConnected),true);
  await page.evaluate(()=>window.scopedTitle.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await settled();
  const original=await page.evaluate(id=>window.tabsApp.getStore().getPage(id),source.id);
  assert.equal(find(original.blocks,tabs.id).tabs.find(t=>t.id===tabs.ids[1]).title,'Draft belongs to A');
  assert.deepEqual(await block(tabs.id),baseline);await page.evaluate(()=>window.tabsApp.setView({sidebarOpen:false}));
  console.log(`${engine} ${basePath||'/'}: ${orientation} stale controls scoped to original page despite shared IDs and composition passed.`);
}

async function failedRenameRecovery(orientation,nested=false) {
  const sourcePage=(await call('page_add',{title:`Recovery ${orientation} ${nested?'nested':'root'}`})).pageId;
  const outer=await group(nested?(orientation==='horizontal'?'vertical':'horizontal'):orientation,null,'Recovery');
  const tabs=nested?await group(orientation,outer.ids[0],'Nested recovery'):outer,id=tabs.ids[1];
  const destination=(await call('page_add',{title:'Recovery destination'})).pageId;await call('page_select',{pageId:sourcePage});
  const fail=()=>page.evaluate(()=>{window.savedPut=IDBObjectStore.prototype.put;const name=window.tabsApp.getStore().databaseName();IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===name)throw new DOMException('Injected tab quota exceeded','QuotaExceededError');return window.savedPut.apply(this,args);};});
  const restore=()=>page.evaluate(()=>{IDBObjectStore.prototype.put=window.savedPut;});
  const start=async value=>{await header(id).press('F2');await titleInput().evaluate((el,value)=>{window.failedIME=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value=value;},value);};
  const end=async()=>{await fail();await page.evaluate(()=>window.failedIME.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await page.getByRole('button',{name:'Retry tab rename',exact:true}).waitFor();await page.waitForFunction(()=>window.failedIME.isConnected&&!window.failedIME.disabled);await page.evaluate(()=>window.tabsApp.getStore().idle());};
  const draft='Tiếng Việt 世界 — retry';await start(draft);await reorder(tabs.id,tabs.ids[2],tabs.ids[3],true,orientation);
  const before=await revision(),history=await page.evaluate(()=>window.tabsApp.getStore().residency().undoEntries);await end();
  assert.equal(await titleInput().inputValue(),draft);assert.equal(await titleInput().isVisible(),true);assert.equal(await revision(),before);
  await screenshot(`${orientation}-${nested?'nested':'root'}-recovery`);
  await call('page_select',{pageId:destination});assert.equal(await titleInput().isVisible(),true);assert.equal(await titleInput().inputValue(),draft);assert.equal(await page.locator('#notices .tab-title-input').count(),1);
  await page.evaluate(()=>{window.savedCopy=navigator.clipboard.writeText; navigator.clipboard.writeText=value=>{window.copiedTabDraft=value;return Promise.resolve();};});
  await page.getByRole('button',{name:'Copy tab title draft',exact:true}).click();assert.equal(await page.evaluate(()=>window.copiedTabDraft),draft);assert.equal(await revision(),before);
  await call('page_select',{pageId:sourcePage});assert.equal(await header(id).locator('..').locator('.tab-title-input').count(),1);assert.equal(await titleInput().inputValue(),draft);
  await restore();await page.evaluate(()=>{const store=window.tabsApp.getStore();window.retryDispatch=store.dispatch;store.dispatch=(name,...args)=>name==='tab_update'?new Promise(resolve=>{window.completeRetry=()=>resolve(window.retryDispatch(name,...args));}):window.retryDispatch(name,...args);});
  await page.getByRole('button',{name:'Retry tab rename',exact:true}).click();assert.equal(await titleInput().isEnabled(),false);assert.equal(await page.getByRole('button',{name:'Cancel tab rename',exact:true}).isEnabled(),false);
  await page.evaluate(()=>{window.tabsApp.getStore().dispatch=window.retryDispatch;window.completeRetry();});await settled();assert.equal(await titleOf(tabs,id),draft);assert.equal(await revision(),before+1);assert.equal(await page.evaluate(()=>window.tabsApp.getStore().residency().undoEntries),history+1);assert.equal(await page.locator('.tab-title-recovery').count(),0);
  await start('Cancel this composed draft');const ids=(await block(tabs.id)).tabs.map(t=>t.id);await reorder(tabs.id,ids.at(-1),ids[0],false,orientation);const cancelBefore=await revision();await end();
  await page.getByRole('button',{name:'Cancel tab rename',exact:true}).click();assert.equal(await titleInput().count(),0);assert.equal(await revision(),cancelBefore);await restore();assert.equal(await titleOf(tabs,id),draft);
  await header(id).press('F2');await titleInput().fill('Disconnected plain draft');const detachedBefore=await revision();await fail();
  await call('page_select',{pageId:destination});await page.getByRole('button',{name:'Retry tab rename',exact:true}).waitFor();assert.equal(await titleInput().inputValue(),'Disconnected plain draft');
  await call('page_select',{pageId:sourcePage});assert.equal(await header(id).locator('..').locator('.tab-title-input').count(),1,'failed plain draft remains observed and reattaches after navigation');
  await page.getByRole('button',{name:'Cancel tab rename',exact:true}).click();await restore();assert.equal(await revision(),detachedBefore);assert.equal(await titleOf(tabs,id),draft);
  await page.evaluate(()=>{navigator.clipboard.writeText=window.savedCopy;});await page.getByRole('button',{name:'Dismiss message'}).evaluateAll(buttons=>buttons.forEach(button=>button.click()));
  await page.reload();await ready();assert.equal(await titleOf(tabs,id),draft);
  console.log(`${engine} ${basePath||'/'}: ${orientation} ${nested?'nested':'root'} IME quota failure retains inline draft across redraw/navigation, copy, retry and cancel passed.`);
}

async function inactiveDoubleClick(orientation,nested=false) {
  await call('page_add',{title:`Double-click ${orientation} ${nested?'nested':'root'}`});
  const outer=await group(nested?(orientation==='horizontal'?'vertical':'horizontal'):orientation,null,'Quick edits');
  const tabs=nested?await group(orientation,outer.ids[0],'Nested quick edits'):outer,id=tabs.ids[1];
  for(let attempt=0;attempt<12;attempt++){
    await header(tabs.ids[0]).click();await settled();const before=await revision(),old=await titleOf(tabs,id);
    await page.evaluate(()=>{window.tabClickTrace=[];if(!window.traceTabs){window.traceTabs=event=>{window.tabClickTrace.push([event.type,event.detail,event.target.id,event.target.className,performance.now(),document.querySelectorAll('.tab-title-input').length]);};for(const name of ['mousedown','mouseup','click','dblclick'])document.addEventListener(name,window.traceTabs,true);}});
    await header(id).dblclick({delay:0});try{await titleInput().waitFor();}catch(error){console.log(await page.evaluate(()=>window.tabClickTrace));await screenshot(`${orientation}-${nested?'nested':'root'}-dblclick-failure`);throw error;}await page.evaluate(async()=>{await window.tabsApp.getStore().idle();await new Promise(requestAnimationFrame);});
    assert.equal(await titleInput().isVisible(),true);assert.equal(await titleInput().inputValue(),old);assert.equal(await header(id).locator('..').locator('.tab-title-input').count(),1);assert.equal((await block(tabs.id)).activeTabId,id);assert.equal(await revision(),before+1);
    if(attempt===0)await screenshot(`${orientation}-${nested?'nested':'root'}-inactive-dblclick`);
    await titleInput().fill('Zero-delay inline edit');await titleInput().press('Enter');await settled();assert.equal(await titleOf(tabs,id),'Zero-delay inline edit');assert.equal(await revision(),before+2);
    await page.locator('#undo-button').click();await settled();assert.equal(await titleOf(tabs,id),old);await header(id).click();await settled();assert.equal(await page.evaluate(()=>window.tabsApp.getStore().canRedo()),true);
  }
  console.log(`${engine} ${basePath||'/'}: ${orientation} ${nested?'nested':'root'} zero-delay inactive double-click retains live editor and one rename history entry passed.`);
}

try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1400},colorScheme:'light'});context.setDefaultTimeout(10000);
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await ready();
  await mkdir(`${root}/test-results`,{recursive:true});

  for(const orientation of ['horizontal','vertical'])await staleTabControls(orientation);
  for(const orientation of ['horizontal','vertical'])for(const nested of [false,true])await failedRenameRecovery(orientation,nested);
  for(const orientation of ['horizontal','vertical'])for(const nested of [false,true])await inactiveDoubleClick(orientation,nested);

  for(const orientation of ['horizontal','vertical']) {
    await call('page_add',{title:`Drag ${orientation} tabs without losing your work`});
    const outer=await group(orientation,null,'Chapters'),opposite=orientation==='horizontal'?'vertical':'horizontal';
    const nested=await group(opposite,outer.ids[0],'Nested'),other=await group(orientation,null,'Other block');
    const [a,b,c,d]=outer.ids,original=await block(outer.id);
    const verify=async(ids)=>{const current=await block(outer.id);assert.deepEqual(current.tabs.map(t=>t.id),ids);assert.equal(current.activeTabId,a);for(const tab of current.tabs)assert.deepEqual(tab,original.tabs.find(t=>t.id===tab.id));assert.equal(await header(a).getAttribute('aria-selected'),'true');assert.equal(await header(b).getAttribute('aria-selected'),'false');};

    // Forward/backward, both ends and adjacent moves; inactive drags never select.
    await reorder(outer.id,b,d,true,orientation,`${orientation}-indicator`);await verify([a,c,d,b]);
    await page.locator('#undo-button').click();await settled();await verify([a,b,c,d]);
    await page.locator('#redo-button').click();await settled();await verify([a,c,d,b]);
    await reorder(outer.id,b,a,false,orientation);await verify([b,a,c,d]);
    await reorder(outer.id,b,a,true,orientation);await verify([a,b,c,d]);
    await reorder(outer.id,b,c,true,orientation);await verify([a,c,b,d]);
    await screenshot(`${orientation}-reordered`);
    await page.reload();await ready();await verify([a,c,b,d]);

    // Nested opposite-orientation headers have independent ordering and markers.
    const nestedBefore=await block(nested.id),[na,nb,nc,nd]=nested.ids;
    await reorder(nested.id,nb,nd,true,opposite,`${orientation}-nested-indicator`);
    const nestedAfter=await block(nested.id);assert.deepEqual(nestedAfter.tabs.map(t=>t.id),[na,nc,nd,nb]);assert.equal(nestedAfter.activeTabId,na);
    for(const t of nestedAfter.tabs)assert.deepEqual(t,nestedBefore.tabs.find(x=>x.id===t.id));
    assert.deepEqual((await block(outer.id)).tabs.map(t=>t.id),[a,c,b,d]);
    // No-op includes either half of the source and the neighboring insertion gap.
    for(const [source,target,after]of [[c,c,false],[c,c,true],[c,b,false],[b,c,true]])await unchanged(()=>reorder(outer.id,source,target,after,orientation));
    await unchanged(async()=>{await startDrag(header(b),header(d));await page.keyboard.press('Escape');await page.mouse.up();});
    await unchanged(()=>drag(header(b),page.locator('#page-title')));
    await unchanged(()=>drag(header(b),header(other.ids[1])));
    await unchanged(()=>drag(header(nb),header(b)));
    await unchanged(()=>drag(header(b),header(nb)));
    await unchanged(()=>drag(header(b),page.locator('.block-list[data-container="page"] > .drop-slot').first()));

    // Text/rename edits use the existing flush + composition guard while reordering.
    const editor=page.locator(`[id="${outer.texts[0]}-text"]`);
    await editor.fill('Pending Markdown content');await header(a).press('F2');await page.getByRole('textbox',{name:'Rename tab',exact:true}).fill('Renamed before drag');
    await reorder(outer.id,d,a,false,orientation);assert.equal((await block(outer.id)).tabs.find(t=>t.id===a).title,'Renamed before drag');assert.equal((await block(outer.texts[0])).text,'Pending Markdown content');
    await header(a).press('F2');const rename=page.getByRole('textbox',{name:'Rename tab',exact:true});
    await rename.evaluate(el=>{window.composingTitle=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Tên đang nhập';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
    await reorder(outer.id,b,d,false,orientation);
    assert.equal(await page.evaluate(()=>window.composingTitle.isConnected),true);
    await page.evaluate(()=>window.composingTitle.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'Tên đang nhập'})));await settled();
    assert.equal((await block(outer.id)).tabs.find(t=>t.id===a).title,'Tên đang nhập');
    await editor.evaluate(el=>{window.composingEditor=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
    await editor.fill('Nội dung đang nhập');await startDrag(header(b),header(a).locator('..'),`after-${orientation==='horizontal'?'x':'y'}`);await page.mouse.up();
    const composingDragFlush=settled();
    assert.equal(await page.evaluate(()=>window.composingEditor.isConnected),true);
    await page.evaluate(()=>window.composingEditor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await composingDragFlush;
    await page.evaluate(()=>{window.tabsStore=window.tabsApp.getStore();});
    await page.waitForFunction(id=>window.tabsStore.getState().blocks.some(b=>b.type==='tabs'&&b.tabs.some(t=>t.blocks.some(x=>x.id===id&&x.text==='Nội dung đang nhập'))),outer.texts[0]);await settled();
    assert.equal((await block(outer.texts[0])).text,'Nội dung đang nhập');

    // ARIA and normal click/keyboard selection still operate in the new order.
    await header(c).click();await settled();assert.equal((await block(outer.id)).activeTabId,c);
    await header(c).press('Home');await settled();assert.equal((await block(outer.id)).activeTabId,(await block(outer.id)).tabs[0].id);await focused((await block(outer.id)).activeTabId);
    await page.keyboard.press('End');await settled();assert.equal((await block(outer.id)).activeTabId,(await block(outer.id)).tabs.at(-1).id);await focused((await block(outer.id)).activeTabId);
    await page.keyboard.press(orientation==='horizontal'?'ArrowLeft':'ArrowUp');await settled();assert.equal((await block(outer.id)).activeTabId,(await block(outer.id)).tabs.at(-2).id);
    const active=(await block(outer.id)).activeTabId,index=(await block(outer.id)).tabs.findIndex(t=>t.id===active);
    await own(outer.id).getByRole('button',{name:'Move tab up',exact:true}).click();await settled();assert.equal((await block(outer.id)).tabs[index-1].id,active);
    assert.equal(await tablist(outer.id).getAttribute('aria-orientation'),orientation);
    await inlineRename(outer,nested,orientation);
    await page.evaluate(async()=>await window.tabsApp.setView({theme:'dark'}));await screenshot(`${orientation}-dark`);
    await page.reload();await ready();
    assert.equal((await block(outer.texts[0])).text,'Nội dung đang nhập');assert.equal((await block(outer.id)).tabs.find(t=>t.id===a).title,'Tên đang nhập');
    await page.evaluate(async()=>await window.tabsApp.setView({theme:'light'}));
    console.log(`${engine} ${basePath||'/'}: ${orientation} + nested ${opposite}, native pointer reorder, selection/content, no-op/cancel, history/reload, pending edits/IME and keyboard passed.`);
  }

  // Wrapping horizontal rows use both pointer axes, not just x coordinates.
  await call('page_add',{title:'Wrapped tabs'});const wrapped=await group('horizontal',null,'A long chapter title');
  await page.setViewportSize({width:460,height:1400});
  await page.waitForFunction(id=>{const headers=document.querySelector(`[data-block-id="${id}"] > .tab-group > .tabs-layout > .tablist`).querySelectorAll('[role=tab]');return new Set([...headers].map(h=>h.getBoundingClientRect().y)).size>1;},wrapped.id);
  const bounds=await Promise.all(wrapped.ids.map(id=>header(id).boundingBox()));assert.ok(new Set(bounds.map(b=>b.y)).size>1);
  await reorder(wrapped.id,wrapped.ids[0],wrapped.ids[3],true,'horizontal');assert.equal((await block(wrapped.id)).tabs.at(-1).id,wrapped.ids[0]);
  await reorder(wrapped.id,wrapped.ids[0],wrapped.ids[1],false,'horizontal');assert.equal((await block(wrapped.id)).tabs[0].id,wrapped.ids[0]);
  await page.setViewportSize({width:1440,height:1400});

  // Tab drags must not leak into block/kanban targets, nor admit external payloads.
  await call('page_add',{title:'Independent drag types'});const tabs=await group('horizontal',null,'Tabs');
  const divider=(await call('add_block',{type:'text',text:'Move this block'})).blockId,board=(await call('add_block',{type:'kanban'})).blockId;
  const columns=(await block(board)).columns,card=(await call('card_add',{blockId:board,columnId:columns[0].id,title:'Drag this card',description:'Keep me'})).cardId;
  const column=i=>page.locator(`[data-block-id="${board}"] .kanban-column`).nth(i);
  const blockHandle=page.locator(`[data-block-id="${divider}"] > .block-controls`).getByRole('button',{name:'Drag block',exact:true});
  await unchanged(()=>drag(header(tabs.ids[1]),column(1).locator('.cards')));
  await unchanged(()=>blockDrag(blockHandle,header(tabs.ids[1])));
  await unchanged(()=>drag(page.locator(`[data-card-id="${card}"]`).getByRole('button',{name:'Drag card',exact:true}),header(tabs.ids[1])));
  await page.evaluate(()=>{const el=document.createElement('div');el.id='external-drag';el.textContent='External payload';el.draggable=true;el.style='position:fixed;right:20px;top:20px;padding:20px;background:white;z-index:9999';el.addEventListener('dragstart',e=>e.dataTransfer.setData('application/x-omd',JSON.stringify({kind:'tab',blockId:'forged',tabId:'forged'})));document.body.append(el);});
  await unchanged(()=>drag(page.locator('#external-drag'),header(tabs.ids[1])));await page.locator('#external-drag').evaluate(el=>el.remove());
  await blockDrag(blockHandle,page.locator('.block-list[data-container="page"] > .drop-slot').first());assert.equal((await state()).blocks[0].id,divider);
  await drag(page.locator(`[data-card-id="${card}"]`).getByRole('button',{name:'Drag card',exact:true}),column(1).locator('.cards'));
  assert.equal((await block(board)).columns[1].cards[0].id,card);assert.equal((await block(board)).columns[1].cards[0].description,'Keep me');
  await drag(column(0).getByRole('button',{name:'Drag column',exact:true}),column(2));assert.equal((await block(board)).columns[2].id,columns[0].id);

  const sourcePage=(await state()).id;await call('page_add',{title:'A different page'});const next=await group('horizontal',null,'Other page');await call('page_select',{pageId:sourcePage});
  await startDrag(header(tabs.ids[1]),header(tabs.ids[0]));await call('page_select',{pageId:(await page.evaluate(()=>window.tabsApp.getStore().listPages())).find(p=>p.title==='A different page').pageId});
  const before=await revision(),destination=await header(next.ids[1]).boundingBox();await page.mouse.move(destination.x+10,destination.y+10);await page.mouse.up();await settled();assert.equal(await revision(),before);
  await call('page_select',{pageId:sourcePage});assert.deepEqual((await block(tabs.id)).tabs.map(t=>t.id),tabs.ids);
  assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: wrapped rows, external/cross-page rejection and block/card/column native DnD regression passed.`);
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,colorScheme:'light'});mobile.setDefaultTimeout(10000);
  page=await mobile.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await ready();
  for(const orientation of ['horizontal','vertical']) {
    const tabs=await group(orientation,null,'Touch fallback');
    await header(tabs.ids[1]).locator('..').getByRole('button',{name:/Rename/}).tap();await titleInput().fill(`Touch ${orientation}`);await titleInput().press('Enter');await settled();
    assert.equal((await block(tabs.id)).activeTabId,tabs.ids[0]);assert.equal(await titleOf(tabs,tabs.ids[1]),`Touch ${orientation}`);
    await own(tabs.id).getByRole('button',{name:'Move tab down',exact:true}).tap();await settled();assert.deepEqual((await block(tabs.id)).tabs.map(t=>t.id),[tabs.ids[1],tabs.ids[0],...tabs.ids.slice(2)]);
    await own(tabs.id).getByRole('button',{name:'Move tab up',exact:true}).tap();await settled();assert.deepEqual((await block(tabs.id)).tabs.map(t=>t.id),tabs.ids);
    await screenshot(`${orientation}-mobile-fallback`);
  }
  assert.deepEqual(errors,[]);console.log(`${engine} ${basePath||'/'}: mobile touch rename and move-controls fallback passed.`);
} finally {await browser?.close();server.kill();}
