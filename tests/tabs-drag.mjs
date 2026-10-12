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
const call=(name,input={})=>page.evaluate(async({name,input})=>(await import('./src/app.js')).getStore().dispatch(name,input),{name,input});
const settled=()=>page.evaluate(async()=>{const app=await import('./src/app.js');await app.flushPending();await app.getStore().idle();});
const state=()=>page.evaluate(async()=>(await import('./src/app.js')).getStore().getPage());
const revision=()=>page.evaluate(async()=>(await import('./src/app.js')).getStore().getRevision());
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
  await startDrag(header(source),header(target),`${after?'after':'before'}-${orientation==='horizontal'?'x':'y'}`);
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

try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1400},colorScheme:'light'});context.setDefaultTimeout(10000);
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.evaluate(async()=>await (await import('./src/app.js')).ready);
  await mkdir(`${root}/test-results`,{recursive:true});

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
    await page.reload();await page.evaluate(async()=>await (await import('./src/app.js')).ready);await verify([a,c,b,d]);

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
    await editor.fill('Pending Markdown content');await own(outer.id).getByRole('textbox',{name:'Rename active tab'}).fill('Renamed before drag');
    await reorder(outer.id,d,a,false,orientation);assert.equal((await block(outer.id)).tabs.find(t=>t.id===a).title,'Renamed before drag');assert.equal((await block(outer.texts[0])).text,'Pending Markdown content');
    const rename=own(outer.id).getByRole('textbox',{name:'Rename active tab'});
    await rename.evaluate(el=>{window.composingTitle=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Tên đang nhập';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
    await reorder(outer.id,b,d,false,orientation);
    assert.equal(await page.evaluate(()=>window.composingTitle.isConnected),true);
    await page.evaluate(()=>window.composingTitle.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'Tên đang nhập'})));await settled();
    assert.equal((await block(outer.id)).tabs.find(t=>t.id===a).title,'Tên đang nhập');
    await editor.evaluate(el=>{window.composingEditor=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));});
    await editor.fill('Nội dung đang nhập');await reorder(outer.id,b,a,true,orientation);
    assert.equal(await page.evaluate(()=>window.composingEditor.isConnected),true);
    await page.evaluate(()=>window.composingEditor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
    await page.evaluate(async()=>{window.tabsStore=(await import('./src/app.js')).getStore();});
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
    await page.evaluate(async()=>await (await import('./src/app.js')).setView({theme:'dark'}));await screenshot(`${orientation}-dark`);
    await page.reload();await page.evaluate(async()=>await (await import('./src/app.js')).ready);
    assert.equal((await block(outer.texts[0])).text,'Nội dung đang nhập');assert.equal((await block(outer.id)).tabs.find(t=>t.id===a).title,'Tên đang nhập');
    await page.evaluate(async()=>await (await import('./src/app.js')).setView({theme:'light'}));
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
  await startDrag(header(tabs.ids[1]),header(tabs.ids[0]));await call('page_select',{pageId:(await page.evaluate(async()=>(await import('./src/app.js')).getStore().listPages())).find(p=>p.title==='A different page').pageId});
  const before=await revision(),destination=await header(next.ids[1]).boundingBox();await page.mouse.move(destination.x+10,destination.y+10);await page.mouse.up();await settled();assert.equal(await revision(),before);
  await call('page_select',{pageId:sourcePage});assert.deepEqual((await block(tabs.id)).tabs.map(t=>t.id),tabs.ids);
  assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: wrapped rows, external/cross-page rejection and block/card/column native DnD regression passed.`);
} finally {await browser?.close();server.kill();}
