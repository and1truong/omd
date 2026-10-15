import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';

const engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4358${basePath}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,OMD_PORT:'4358',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser;
const boot=async page=>{await page.goto(url);await page.evaluate(async source=>{window.app=await import(source);await app.ready;window.store=app.getStore();},new URL('src/app.js',url).href);};
const unload=page=>page.evaluate(()=>{const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;});
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch();
  const context=await browser.newContext(),page=await context.newPage();await boot(page);
  const heading=await page.evaluate(async()=>{await store.dispatch('page_add',{title:'Draft protection'});return store.dispatch('add_block',{type:'heading',text:'Original heading'});});
  const peer=await context.newPage();await boot(peer);await peer.evaluate(id=>store.dispatch('page_select',{pageId:id}),await page.evaluate(()=>store.getActivePageId()));
  await page.evaluate(()=>{const dispatch=store.dispatch;store.dispatch=(name,input,options)=>name==='update_block'&&input.patch?.text==='Unsaved local heading'?Promise.reject(new Error('Injected write failure')):dispatch(name,input,options);});
  const input=page.getByRole('textbox',{name:'heading content',exact:true});await input.fill('Unsaved local heading');await page.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');
  await peer.evaluate(blockId=>store.dispatch('update_block',{blockId,patch:{text:'Peer saved heading'}}),heading.blockId);await page.waitForTimeout(500);
  assert.equal(await input.inputValue(),'Unsaved local heading');assert.equal(await page.evaluate(()=>store.getState().blocks[0].text),'Original heading');assert.equal(await unload(page),true);
  await context.close();

  const navigation=await browser.newContext(),nav=await navigation.newPage();await boot(nav);
  const ids=await nav.evaluate(async()=>{const first=(await store.dispatch('page_add',{title:'Original page'})).pageId,second=(await store.dispatch('page_add',{title:'Destination page'})).pageId;await store.dispatch('page_select',{pageId:first});const dispatch=store.dispatch;window.restoreDispatch=()=>store.dispatch=dispatch;store.dispatch=(name,input,options)=>name==='set_page'&&input.title==='Composed original-page draft'?Promise.reject(new Error('Injected navigated IME failure')):dispatch(name,input,options);return {first,second};});
  await nav.locator('#page-title').evaluate(el=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Composed original-page draft';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await nav.evaluate(async({first,second})=>{await app.flushPending();await store.dispatch('set_page',{pageId:second,subtitle:'Background change'});await app.flushPending();await store.dispatch('page_select',{pageId:second});},ids);
  await nav.locator('#page-title').dispatchEvent('compositionend');await nav.waitForFunction(()=>document.getElementById('notices').textContent.includes('Injected navigated IME failure'));assert.equal(await nav.locator('#page-title').inputValue(),'Destination page');
  // Returning through real page navigation exposes the retained original-page draft.
  await nav.getByRole('link',{name:'Switch to Original page',exact:true}).click();await nav.waitForFunction(id=>store.getActivePageId()===id,ids.first);assert.equal(await nav.locator('#page-title').inputValue(),'Composed original-page draft');
  await nav.evaluate(async()=>{restoreDispatch();await app.flushPending();});assert.equal(await nav.evaluate(async id=>(await store.getPage(id)).title,ids.first),'Composed original-page draft');assert.equal(await nav.evaluate(async id=>(await store.getPage(id)).title,ids.second),'Destination page');await navigation.close();

  // Headers are reused across pages; input events after a switch still belong to composition's source page.
  for(const field of ['title','subtitle']){
    const headers=await browser.newContext(),header=await headers.newPage();await boot(header);
    const pages=await header.evaluate(async()=>{const first=(await store.dispatch('page_add',{title:'Header source'})).pageId;await store.dispatch('set_page',{subtitle:'Source subtitle'});const second=(await store.dispatch('page_add',{title:'Header destination'})).pageId;await store.dispatch('set_page',{subtitle:'Destination subtitle'});await store.dispatch('page_select',{pageId:first});return {first,second};});
    const control=header.locator(`#page-${field}`);await control.evaluate(el=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Partial composition';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
    await header.evaluate(async pageId=>{await app.flushPending();await store.dispatch('page_select',{pageId});},pages.second);
    await control.evaluate(el=>{el.value='Final source composition';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
    await header.waitForFunction(async({first,field})=>(await store.getPage(first))[field]==='Final source composition',{first:pages.first,field});await header.evaluate(()=>app.flushPending());
    assert.equal(await header.evaluate(async({second,field})=>(await store.getPage(second))[field],{second:pages.second,field}),field==='title'?'Header destination':'Destination subtitle');
    await header.evaluate(async pageId=>{await store.dispatch('page_select',{pageId});await app.flushPending();},pages.first);assert.equal(await control.inputValue(),'Final source composition');await headers.close();
  }

  // Rich Markdown drafts must outlive their editor when navigation finishes before an IME save.
  const richContext=await browser.newContext(),rich=await richContext.newPage();await boot(rich);
  const richIds=await rich.evaluate(async()=>{const first=(await store.dispatch('page_add',{title:'Rich original page'})).pageId;await store.dispatch('add_block',{type:'text',text:'Saved original text'});const second=(await store.dispatch('page_add',{title:'Rich destination'})).pageId;await store.dispatch('page_select',{pageId:first});const dispatch=store.dispatch;window.restoreDispatch=()=>store.dispatch=dispatch;store.dispatch=(name,input,options)=>name==='update_block'&&input.patch?.text==='Composed rich draft'?Promise.reject(new Error('Injected navigated rich failure')):dispatch(name,input,options);return {first,second};});
  await rich.getByRole('textbox',{name:'text content',exact:true}).evaluate(el=>{window.oldEditor=el;el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Composed rich draft'}));el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await rich.evaluate(async id=>{await app.flushPending();await store.dispatch('page_select',{pageId:id});oldEditor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));},richIds.second);await rich.waitForFunction(()=>document.getElementById('notices').textContent.includes('Injected navigated rich failure'));await rich.waitForFunction(()=>document.getElementById('page-title').value==='Rich destination');
  assert.equal(await unload(rich),true);await rich.getByRole('link',{name:'Switch to Rich original page',exact:true}).click();await rich.waitForFunction(id=>store.getActivePageId()===id,richIds.first);assert.equal(await rich.getByRole('textbox',{name:'text content',exact:true}).textContent(),'Composed rich draft');
  await rich.evaluate(async()=>{restoreDispatch();await app.flushPending();});assert.equal(await rich.evaluate(()=>store.getState().blocks[0].text),'Composed rich draft');await richContext.close();

  const composing=await browser.newContext(),ime=await composing.newPage();await boot(ime);
  await ime.evaluate(async()=>{await store.dispatch('page_add',{title:'IME protection'});await store.dispatch('add_block',{type:'text',text:'Before IME'});});
  const text=ime.getByRole('textbox',{name:'text content',exact:true});
  await text.evaluate(el=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Tiếng Việt đang nhập'}));el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  assert.equal(await unload(ime),true);assert.equal(await ime.evaluate(()=>store.getState().blocks[0].text),'Before IME');
  await text.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await ime.waitForFunction(()=>store.getState().blocks[0].text.includes('Tiếng Việt đang nhập'));await ime.evaluate(()=>app.flushPending());

  const reminder=await ime.evaluate(()=>store.dispatch('add_block',{type:'reminder',title:'Reminder before IME',dueAt:'2099-01-01T00:00:00Z'}));
  await ime.evaluate(()=>{const dispatch=store.dispatch;window.restoreDispatch=()=>store.dispatch=dispatch;store.dispatch=(name,input,options)=>name==='update_block'&&input.patch?.title==='Keep the composed draft'?Promise.reject(new Error('Injected composed write failure')):dispatch(name,input,options);});
  const reminderInput=ime.getByRole('textbox',{name:'Reminder text',exact:true});
  await reminderInput.evaluate(el=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Keep the composed draft';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
  await ime.evaluate(blockId=>store.dispatch('reminder_fired',{blockId,firedAt:'2099-01-01T00:00:00Z'},{quiet:true,reminderBlockId:blockId,reminderPageId:store.getActivePageId()}),reminder.blockId);
  await reminderInput.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await ime.waitForFunction(()=>document.getElementById('notices').textContent.includes('Injected composed write failure'));
  assert.equal(await reminderInput.inputValue(),'Keep the composed draft');assert.equal(await reminderInput.evaluate(el=>el.isConnected),true);
  await ime.evaluate(async()=>{restoreDispatch();await app.flushPending();});assert.equal(await reminderInput.inputValue(),'Keep the composed draft');assert.equal(await ime.locator('#save-status').textContent(),'Saved');
  // Real canvas edits also need unload protection when their IndexedDB save fails.
  const drawing=await ime.evaluate(async()=>{await store.dispatch('page_add',{title:'Canvas draft protection'});return store.dispatch('add_block',{type:'excalidraw'});});
  await ime.locator('.excalidraw canvas').first().waitFor();await ime.getByRole('button',{name:'Open canvas full page',exact:true}).click();await ime.locator('#canvas-stage .excalidraw label[title*="Rectangle"]').first().click();
  await ime.evaluate(()=>{const dispatch=store.dispatch;window.restoreDispatch=()=>store.dispatch=dispatch;store.dispatch=(name,input,options)=>name==='update_block'&&input.patch?.scene?Promise.reject(new Error('Injected canvas write failure')):dispatch(name,input,options);});
  const box=await ime.locator('#canvas-stage .excalidraw canvas').first().boundingBox(),x=box.x+Math.max(250,box.width*.5),y=box.y+Math.max(150,box.height*.35);
  await ime.mouse.move(x,y);await ime.mouse.down();await ime.mouse.move(x+90,y+90,{steps:6});await ime.mouse.up();await ime.waitForFunction(()=>document.getElementById('notices').textContent.includes('Injected canvas write failure'));
  assert.equal(await unload(ime),true);assert.equal(await ime.evaluate(id=>store.getState().blocks.find(b=>b.id===id).scene.elements.length,drawing.blockId),0);
  await ime.evaluate(async()=>{restoreDispatch();await app.flushPending();});assert.equal(await ime.evaluate(id=>store.getState().blocks.find(b=>b.id===id).scene.elements.length,drawing.blockId),1);
  await composing.close();console.log(`${engine} ${basePath||'/'}: local peer refresh, generic failed drafts, composing unload, reminder/IME and canvas failure/retry passed.`);
}finally{await browser?.close();server.kill();}
