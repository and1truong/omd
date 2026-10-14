import {waitForServer} from './server-ready.mjs';
import assert from 'node:assert/strict';import {spawn} from 'node:child_process';import {chromium,webkit} from 'playwright';
const root=new URL('..',import.meta.url).pathname,engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'',url=`http://localhost:4331${base}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4331',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});let browser;
try{
 await waitForServer(server);browser=await({chromium,webkit}[engine]).launch();const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage();
 await page.goto(url);await page.evaluate(async()=>{window.app=await import(new URL('./src/app.js',document.baseURI).href);await app.ready;window.store=app.getStore();window.dragEvents=[];for(const type of ['dragstart','dragover','drop'])document.addEventListener(type,e=>dragEvents.push({type,trusted:e.isTrusted}),true);});
 const call=(name,input)=>page.evaluate(async({name,input})=>{await app.flushPending();return store.dispatch(name,input);},{name,input});const rows=()=>page.evaluate(()=>store.listPages()),row=id=>page.locator('.sidebar-page').filter({has:page.locator(`[data-page-id="${id}"]`)});
 const node=id=>page.locator(`.sidebar-page[data-page-id="${id}"]`);
 await call('set_page',{title:'Root A'});const a=(await rows())[0].pageId,b=(await call('page_add',{title:'Root B'})).pageId,c=(await call('page_add',{title:'Root C'})).pageId;
 const child=(await call('page_add',{title:'A child',parentId:a})).pageId,leaf=(await call('page_add',{title:'A leaf',parentId:child})).pageId;await call('add_block',{type:'text',text:'Preserved leaf content'});await call('page_select',{pageId:c});
 async function drag(source,target,position='inside'){
  const handle=node(source).locator('.page-drag-handle'),destination=node(target);await destination.scrollIntoViewIfNeeded();await handle.scrollIntoViewIfNeeded();await handle.hover();const from=await handle.boundingBox(),to=await destination.boundingBox();assert.ok(from&&to);
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(from.x+from.width/2+12,from.y+from.height/2);const x=to.x+to.width*.55,y=to.y+to.height*(position==='before'?.1:position==='after'?.9:.5);await page.mouse.move(x,y,{steps:15});await page.mouse.move(x,y);await page.mouse.move(x,y);
  const marker=await destination.getAttribute('data-page-drop');await page.mouse.up();await page.evaluate(()=>app.flushPending());await page.evaluate(()=>store.idle());return marker;
 }
 assert.equal(await drag(a,c,'after'),'after');await page.waitForFunction(({a,c})=>{const roots=store.listPages().filter(p=>!p.parentId);return roots.at(-1).pageId===a&&roots.at(-2).pageId===c;},{a,c});assert.equal(await page.evaluate(()=>store.getActivePageId()),c);assert.equal((await rows()).find(p=>p.pageId===leaf).parentId,child);
 const revision=await page.evaluate(()=>store.getRevision());assert.equal(await drag(a,leaf,'inside'),null);assert.equal(await page.evaluate(()=>store.getRevision()),revision,'Cycle drop must not mutate hierarchy/history.');
 assert.equal(await drag(child,b,'inside'),'inside');await page.waitForFunction(({child,b})=>store.listPages().find(p=>p.pageId===child).parentId===b,{child,b});assert.equal((await rows()).find(p=>p.pageId===leaf).parentId,child);
 await page.evaluate(()=>store.undo());assert.equal((await rows()).find(p=>p.pageId===child).parentId,a);await page.evaluate(()=>store.redo());assert.equal((await rows()).find(p=>p.pageId===child).parentId,b);
 const before=await page.evaluate(()=>store.export());await node(c).evaluate(el=>{const dataTransfer=new DataTransfer();dataTransfer.setData('application/x-omd-page-move','external');el.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer}));});assert.equal(await page.evaluate(()=>store.export()),before,'External payload must not move pages.');
 const native=await page.evaluate(()=>dragEvents.filter(e=>e.type==='dragstart'||e.type==='drop'));assert.ok(native.filter(e=>e.trusted).length>=5,'Use actual native mouse drags.');
 await page.reload();await page.evaluate(async()=>{window.app=await import(new URL('./src/app.js',document.baseURI).href);await app.ready;window.store=app.getStore();});assert.equal((await rows()).find(p=>p.pageId===child).parentId,b);assert.equal((await page.evaluate(id=>store.getPage(id),leaf)).blocks[0].text,'Preserved leaf content');assert.equal(await page.evaluate(()=>store.getActivePageId()),c);
 await node(a).getByRole('link').click();await page.waitForFunction(id=>store.getActivePageId()===id,a);assert.ok(page.url().endsWith(`/page/${a}`));
 await context.close();console.log(`${engine} ${base||'/'}: native page-tree reorder/reparent, subtree/cycle guards, unchanged selection, undo/redo, external payload rejection, links and reload passed.`);
}finally{await browser?.close();server.kill();}
