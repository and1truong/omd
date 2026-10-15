import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {waitForServer} from './server-ready.mjs';
const engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'',url=`http://localhost:4364${base}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,OMD_PORT:'4364',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser,page;const errors=[];
const call=(name,input={})=>page.evaluate(({name,input})=>store.dispatch(name,input),{name,input});
const state=()=>page.evaluate(()=>store.getState());
const settle=()=>page.evaluate(async()=>{await app.flushPending();await store.idle();});
const block=id=>page.locator(`[data-block-id="${id}"]`);
const ownHandle=id=>block(id).locator(':scope > .block-controls > .block-drag');
const row=async()=>(await state()).blocks.find(b=>b.type==='columns');
async function startDrag(id,target,side){
  await block(id).scrollIntoViewIfNeeded();await target.scrollIntoViewIfNeeded();await block(id).hover();const a=await ownHandle(id).boundingBox();assert.ok(a);
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+12,a.y+a.height/2,{steps:3});
  const b=await target.boundingBox();assert.ok(b);const x=side==='left'?b.x+3:side==='right'?b.x+b.width-3:b.x+b.width/2,y=side==='before'?b.y+3:side==='after'?b.y+b.height-3:b.y+b.height/2;
  await page.mouse.move(x,y,{steps:14});await page.mouse.move(x,y);return {x,y};
}
async function drag(id,target,side){await startDrag(id,target,side);await page.mouse.up();await settle();}
try{
  await waitForServer(server);browser=await ({chromium,webkit}[engine]).launch();page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
  await page.goto(url);await page.evaluate(async source=>{window.app=await import(source);await app.ready;window.store=app.getStore();},new URL('src/app.js',url).href);
  const ids=await page.evaluate(async()=>{await store.dispatch('page_add',{title:'Room for every idea'});await store.dispatch('add_block',{type:'heading',text:'A workspace that follows your ideas'});const result=[];for(const [icon,tone,text] of [['🧭','info','## Plan\nCollect ideas, questions and the next small step.'],['🛠️','success','## Build\nBring your notes and tasks together, side by side.'],['🚀','warning','## Share\nDrag either edge to make room for another idea.']])result.push((await store.dispatch('add_block',{type:'callout',icon,tone,text})).blockId);return result;});
  const [a,b,c]=ids;
  await startDrag(b,block(a),'right');await page.waitForFunction(()=>!document.querySelector('.column-drop-preview').hidden);assert.match(await page.locator('.column-drop-preview').textContent(),/right.*2 columns/);await page.mouse.up();await settle();
  assert.deepEqual((await row()).columns.map(c=>c.blocks[0].id),[a,b]);
  const beforeCancel=await page.evaluate(()=>store.export());await startDrag(c,block(a),'left');await page.keyboard.press('Escape');await page.mouse.up();await settle();assert.equal(await page.evaluate(()=>store.export()),beforeCancel);assert.equal(await page.locator('.column-drop-preview').isHidden(),true);
  await drag(c,block(a),'left');assert.deepEqual((await row()).columns.map(c=>c.blocks[0].id),[c,a,b]);
  await mkdir('test-results',{recursive:true});await page.mouse.move(0,0);await page.screenshot({path:`test-results/columns-${engine}-${base?'project':'root'}-desktop.png`,fullPage:true});
  // Preview can be inspected without changing data; block order commits only at drop.
  await startDrag(b,block(c),'left');await page.screenshot({path:`test-results/columns-${engine}-${base?'project':'root'}-drop-left.png`,fullPage:true});await page.mouse.up();await settle();assert.deepEqual((await row()).columns.map(c=>c.blocks[0].id),[b,c,a]);await page.evaluate(()=>store.undo());
  const text=block(a).getByRole('textbox',{name:'callout content',exact:true});await text.fill('A draft saved before moving');
  const targetColumn=(await row()).columns.find(col=>col.blocks.some(x=>x.id===b)).id;
  await drag(a,page.locator(`[data-layout-column="${targetColumn}"] > .block-list > .add-block-button`));assert.equal((await row()).columns.length,2);assert.deepEqual((await row()).columns.at(-1).blocks.map(b=>b.id),[b,a]);assert.equal(await block(a).getByRole('textbox',{name:'callout content',exact:true}).textContent(),'A draft saved before moving');await drag(a,block(b),'before');assert.deepEqual((await row()).columns.at(-1).blocks.map(b=>b.id),[a,b]);await page.evaluate(()=>store.undo());await page.evaluate(()=>store.undo());assert.equal((await row()).columns.length,3);
  await page.reload();await page.evaluate(async source=>{window.app=await import(source);await app.ready;window.store=app.getStore();},new URL('src/app.js',url).href);assert.equal((await row()).columns.length,3);
  await page.setViewportSize({width:390,height:844});const boxes=await page.locator('.layout-row > .layout-column').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width};}));assert.ok(boxes[1].y>boxes[0].y&&boxes[2].y>boxes[1].y);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`test-results/columns-${engine}-${base?'project':'root'}-mobile.png`,fullPage:true});await page.setViewportSize({width:1440,height:1100});
  // Hover controls must not cover ordinary paragraph text in narrow callouts.
  await call('update_block',{blockId:a,patch:{text:'A longer sentence with important words at the right edge. More text flows into this callout.'}});await block(a).hover();
  assert.equal(await block(a).evaluate(node=>{const select=node.querySelector('.callout-tone').getBoundingClientRect(),walker=document.createTreeWalker(node.querySelector('.markdown-editor'),NodeFilter.SHOW_TEXT);let text;while(text=walker.nextNode())for(let i=0;i<text.textContent.length;i++){const range=document.createRange();range.setStart(text,i);range.setEnd(text,i+1);const box=range.getBoundingClientRect();if(box.width&&box.left<select.right&&box.right>select.left&&box.top<select.bottom&&box.bottom>select.top)return false;}return true;}),true);
  // Boundary drag uses actual native data, not a fabricated DataTransfer.
  const many=await page.evaluate(async()=>{await store.dispatch('page_add',{title:'Twelve columns'});const ids=[];for(let i=0;i<13;i++)ids.push((await store.dispatch('add_block',{type:'text',text:`Column ${i+1}`})).blockId);await store.dispatch('move_block',{blockId:ids[1],containerId:'page',targetBlockId:ids[0],side:'right'});for(let i=2;i<12;i++){const layout=store.getState().blocks[0];await store.dispatch('move_block',{blockId:ids[i],containerId:layout.columns.at(-1).id,targetBlockId:ids[i-1],side:'right'});}return ids;});
  const beforeLimit=await page.evaluate(()=>store.export());await startDrag(many[12],block(many[11]),'right');await page.waitForFunction(()=>document.querySelector('.column-drop-preview').dataset.allowed==='false');assert.match(await page.locator('.column-drop-preview').textContent(),/at most 12/);await page.mouse.up();await settle();assert.equal(await page.evaluate(()=>store.export()),beforeLimit);assert.equal((await row()).columns.length,12);
  await drag(many[0],block(many[11]),'right');assert.equal((await row()).columns.length,12);assert.equal((await row()).columns.at(-1).blocks[0].id,many[0]);
  assert.deepEqual(errors,[]);console.log(`${engine} ${base||'/'}: native left/right drops, insertion order, cancel, multi-block columns, empty collapse, draft saves, undo/reload, mobile stacking and 12-column limit passed.`);
}finally{await browser?.close();server.kill();}
