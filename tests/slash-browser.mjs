import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';
const root=new URL('..',import.meta.url).pathname,engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'';
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4341',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});let browser;
try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
  browser=await({chromium,webkit}[engine]).launch();const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(10000);
  const boot=()=>page.evaluate(async()=>{window.app=await import(new URL('./src/app.js',document.baseURI).href);await app.ready;window.store=app.getStore();window.model=await import(new URL('./src/model.js',document.baseURI).href);});
  const call=(name,input)=>page.evaluate(async({name,input})=>{await app.flushPending();return store.dispatch(name,input);},{name,input});
  const box=id=>page.locator(`[id="${id}-text"]`),menu=page.getByRole('listbox',{name:'Block types',exact:true});
  const saved=(id,type)=>page.waitForFunction(({id,type})=>model.findBlock(store.getState(),id).block.type===type,{id,type});
  const focused=id=>page.waitForFunction(id=>document.activeElement?.closest('[data-block-id]')?.dataset.blockId===id,id);
  await page.goto(`http://localhost:4341${base}/`);await boot();await call('page_add',{title:'Slash browser'});
  const first=(await call('add_block',{type:'text',text:'Before'})).blockId,id=(await call('add_block',{type:'text'})).blockId,last=(await call('add_block',{type:'text',text:'After'})).blockId;
  await box(id).focus();await box(id).press('/');await menu.waitFor({state:'visible'});
  assert.equal(await box(id).getAttribute('aria-expanded'),'true');assert.equal(await box(id).evaluate(el=>el===document.activeElement),true);
  assert.equal(await menu.getByRole('option').count(),await page.evaluate(()=>model.BLOCK_TYPES.length+1));
  await box(id).press('ArrowDown');assert.equal(await menu.getByRole('option',{selected:true}).innerText(),'Heading\nGive a thought its own space');
  await box(id).press('Enter');await saved(id,'heading');await focused(id);assert.deepEqual(await page.evaluate(()=>store.getState().blocks.map(b=>b.id)),[first,id,last]);assert.equal(await menu.count(),0);
  await page.evaluate(()=>store.undo());await saved(id,'text');assert.equal(await box(id).textContent(),'/');
  await box(id).fill('/table');await menu.waitFor({state:'visible'});assert.equal(await menu.getByRole('option').count(),1);await box(id).press('Tab');await saved(id,'table');await focused(id);
  await page.evaluate(()=>store.undo());await saved(id,'text');await box(id).fill('/zz-no-such-block');await menu.waitFor({state:'visible'});assert.equal(await menu.getByRole('option').count(),0);await box(id).press('Enter');assert.equal(await box(id).textContent(),'/zz-no-such-block');
  await box(id).press('Escape');await menu.waitFor({state:'hidden'});await box(id).fill('path /table');assert.equal(await menu.isVisible(),false);
  await box(id).fill('/heading');await menu.waitFor({state:'visible'});await box(id).press('Backspace');await box(id).press('ControlOrMeta+a');await box(id).press('Backspace');await menu.waitFor({state:'hidden'});
  // Composition must neither show commands nor convert on its acknowledgement Enter.
  await box(id).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));await box(id).fill('/table');await box(id).press('Enter');assert.equal(await menu.isVisible(),false);assert.equal(await page.evaluate(id=>model.findBlock(store.getState(),id).block.type,id),'text');
  await box(id).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await page.evaluate(()=>app.flushPending());
  await box(id).fill('');await box(id).fill('/table');await menu.waitFor({state:'visible'});
  // A failed durable write keeps the same command editor and permits retry.
  await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;window.restoreWrites=()=>{IDBObjectStore.prototype.put=put;};IDBObjectStore.prototype.put=function(...args){if(this.name==='records')throw new DOMException('slash quota','QuotaExceededError');return put.apply(this,args);};});
  await box(id).press('Enter');await page.waitForFunction(()=>document.getElementById('notices').textContent.includes('slash quota'));assert.equal(await box(id).textContent(),'/table');assert.equal(await box(id).evaluate(el=>el.isContentEditable),true);await page.evaluate(()=>restoreWrites());await box(id).focus();await menu.waitFor({state:'visible'});await box(id).press('Enter');await saved(id,'table');
  // Only the opposite tab direction appears; no tabs appear at a third level.
  const outer=(await call('add_block',{type:'tabs',orientation:'horizontal'})).block,child=(await call('add_block',{type:'text',containerId:outer.tabs[0].id})).blockId;
  await box(child).fill('/tabs');await menu.waitFor({state:'visible'});assert.equal(await menu.getByRole('option').count(),1);assert.match(await menu.innerText(),/Vertical tabs/);await box(child).press('Enter');await saved(child,'tabs');
  const inner=await page.evaluate(id=>model.findBlock(store.getState(),id).block,child),deep=(await call('add_block',{type:'text',containerId:inner.tabs[0].id})).blockId;
  await box(deep).fill('/tabs');await menu.waitFor({state:'visible'});assert.equal(await menu.getByRole('option').count(),0);await box(deep).press('Escape');
  await box(deep).fill('/divider');await menu.waitFor({state:'visible'});await box(deep).press('Enter');await saved(deep,'divider');await focused(deep);
  const nextSource=(await call('add_block',{type:'text',text:'Continue'})).blockId;
  await box(nextSource).focus();await box(nextSource).press('Shift+Enter');await page.keyboard.type('/heading');await menu.waitFor({state:'visible'});await page.keyboard.press('Enter');
  await page.waitForFunction(()=>store.getState().blocks.at(-1).type==='heading');
  const text=(await call('add_block',{type:'text',text:'`/table`'})).blockId;await box(text).focus();assert.equal(await menu.isVisible(),false);
  const checklist=(await call('add_block',{type:'checklist'})).blockId;await call('checklist_add',{blockId:checklist,text:'/table'});await page.getByRole('textbox',{name:'Checklist item',exact:true}).focus();assert.equal(await menu.isVisible(),false);
  // Pointer choice, dismissal, page teardown and mobile viewport placement.
  const click=(await call('add_block',{type:'text'})).blockId;await box(click).fill('/heading');await menu.getByRole('option').click();await saved(click,'heading');await focused(click);
  const mobile=(await call('add_block',{type:'text'})).blockId;await page.setViewportSize({width:390,height:844});await box(mobile).fill('/');await menu.waitFor({state:'visible'});const rect=await menu.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=390&&rect.y>=0&&rect.y+rect.height<=844);
  await page.getByRole('textbox',{name:'Page title',exact:true}).focus();await menu.waitFor({state:'hidden'});await call('page_add',{title:'Other page'});assert.equal(await menu.count(),0);
  await call('page_select',{pageId:await page.evaluate(()=>store.listPages().find(p=>p.title==='Slash browser').pageId)});await page.reload();await boot();await saved(id,'table');assert.equal(await page.locator(`[data-block-id="${deep}"] hr`).count(),1);
  assert.deepEqual(errors,[]);console.log(`${engine} ${base||'/'}: slash keyboard/filter/focus, undo, no matches, dismiss, IME, failure/retry, nesting, exclusions, pointer, mobile and reload passed.`);
} finally {await browser?.close();server.kill();}
