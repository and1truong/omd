import {waitForServer} from './server-ready.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const root=new URL('..',import.meta.url).pathname,engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'';
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_STATIC_DIR:'dist',OMD_PORT:'4328'},stdio:['ignore','pipe','pipe']});
let browser;const evidence=[];
try {
  await waitForServer(server);
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext(),page=await context.newPage();
  await page.goto(`http://localhost:4328${base}/`);
  await page.evaluate(async()=>{window.app=await import(new URL('./src/app.js',document.baseURI).href);await window.app.ready;window.store=window.app.getStore();});
  const call=(name,input)=>page.evaluate(async({name,input})=>{await window.app.flushPending();return window.store.dispatch(name,input);},{name,input});
  await call('page_add',{title:'Focus transitions'});
  for(const nested of [false,true])for(const delay of [0,10,20,40])for(const held of [false,true]) {
    const parent=nested?(await call('add_block',{type:'tabs'})).block:null,containerId=parent?.tabs[0].id??'page';
    const source=(await call('add_block',{type:'text',containerId,text:'Source stays whole'})).blockId;
    await page.locator(`[id="${source}-text"]`).focus();await page.keyboard.press('Control+End');
    await page.evaluate(({held})=>{
      window.events=[];window.observe=e=>window.events.push({type:e.type,key:e.key,data:e.data,id:e.target.id,time:performance.now(),trusted:e.isTrusted});
      for(const type of ['keydown','beforeinput','focusin'])document.addEventListener(type,window.observe,true);
      const dispatch=window.store.dispatch;window.restore=()=>{window.store.dispatch=dispatch;};
      if(held)window.store.dispatch=async(name,input,options)=>{if(name==='add_block')await new Promise(resolve=>setTimeout(resolve,150));return dispatch(name,input,options);};
    },{held});
    await page.keyboard.press('Shift+Enter');if(delay)await page.waitForTimeout(delay);await page.keyboard.type('WebKit typing',{delay});
    try{await page.waitForFunction(()=>!document.querySelector('[data-pending-block]'));}catch(error){console.error(await page.evaluate(()=>({events:window.events,notices:document.getElementById('notices').innerText,editors:[...document.querySelectorAll('[data-text-editor]')].map(n=>({id:n.dataset.textEditor,pending:n.dataset.pendingBlock,connected:n.isConnected,text:n.innerText})),book:window.store.getState()})));throw error;}
    await page.evaluate(()=>window.app.flushPending());
    const result=await page.evaluate(async({source,containerId})=>{
      const {findContainer}=await import(new URL('./src/model.js',document.baseURI).href),blocks=findContainer(window.store.getState(),containerId).blocks,index=blocks.findIndex(b=>b.id===source);
      window.restore();for(const type of ['keydown','beforeinput','focusin'])document.removeEventListener(type,window.observe,true);
      return {events:window.events,order:blocks.map(b=>b.id),source:blocks[index].text,next:blocks[index+1].text,book:await window.store.export()};
    },{source,containerId});
    evidence.push({engine,base,nested,delay,held,...result});
    assert.equal(result.source,'Source stays whole');assert.equal(result.next,'WebKit typing');
    assert.ok(result.events.every(event=>event.trusted),'Keyboard/input/focus events must be native.');
    await page.reload();await page.evaluate(async()=>{window.app=await import(new URL('./src/app.js',document.baseURI).href);await window.app.ready;window.store=window.app.getStore();});
    assert.equal(await page.evaluate(()=>window.store.export()),result.book,'Persisted Markdown/order must survive reload.');
    if(parent)await call('remove_block',{blockId:parent.id});
  }
  // A failed insertion keeps an editable draft and blocks navigation until retry.
  const failed=(await call('add_block',{type:'text',text:'Failure source'})).blockId;
  await page.evaluate(()=>{const dispatch=window.store.dispatch;window.restore=()=>{window.store.dispatch=dispatch;};window.store.dispatch=(name,input,options)=>name==='add_block'?Promise.reject(new Error('Injected insertion quota')):dispatch(name,input,options);});
  await page.locator(`[id="${failed}-text"]`).press('Shift+Enter');await page.keyboard.type('retained draft');
  await page.getByRole('button',{name:'Retry creating block',exact:true}).waitFor({state:'visible'});
  await assert.rejects(()=>page.evaluate(()=>window.app.flushPending()),/next block has not been saved/);
  assert.equal(await page.locator(`[id="${failed}-text"]`).innerText(),'Failure source');
  await page.evaluate(()=>window.restore());await page.getByRole('button',{name:'Retry creating block',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-pending-block]'));await page.evaluate(()=>window.app.flushPending());
  assert.equal(await page.evaluate(()=>window.store.getState().blocks.at(-1).text),'retained draft');
  // Start IME during the insertion gap. Adoption keeps the exact DOM/view and
  // waits for the final composition acknowledgement, rather than stealing focus.
  const imeSource=(await call('add_block',{type:'text',text:'IME source'})).blockId;
  await page.evaluate(()=>{const dispatch=window.store.dispatch;window.restore=()=>{window.store.dispatch=dispatch;};window.store.dispatch=async(name,input,options)=>{if(name==='add_block')await new Promise(resolve=>window.grant=resolve);return dispatch(name,input,options);};});
  await page.locator(`[id="${imeSource}-text"]`).press('Shift+Enter');await page.waitForFunction(()=>!!window.grant);
  await page.evaluate(()=>{window.ime=document.activeElement;window.imeEditor=window.ime.editor;window.ime.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));window.ime.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Tiếng Việt'}));window.ime.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));window.grant();window.restore();});
  await page.waitForFunction(()=>window.store.getState().blocks.at(-1).id!==window.ime.closest('[data-text-editor]').dataset.textEditor);
  assert.equal(await page.evaluate(()=>window.ime.isConnected&&document.activeElement===window.ime),true);
  await page.evaluate(()=>window.ime.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await page.waitForFunction(()=>!document.querySelector('[data-pending-block]'));await page.evaluate(()=>window.app.flushPending());
  assert.equal(await page.evaluate(()=>window.ime.isConnected&&window.ime.editor===window.imeEditor&&document.activeElement===window.ime),true);
  assert.equal(await page.evaluate(()=>window.store.getState().blocks.at(-1).text),'Tiếng Việt');
  assert.equal(await page.locator(`[id="${imeSource}-text"]`).innerText(),'IME source');
  console.log(`${engine} ${base||'/'}: 16 trusted root/tab input transitions, persisted reload, insertion failure/retry and IME adoption passed.`);
  await context.close();
} finally {
  await mkdir(`${root}/test-results`,{recursive:true});await writeFile(`${root}/test-results/editor-transition-${engine}-${base?'project':'root'}.json`,JSON.stringify(evidence,null,2));
  await browser?.close();server.kill();
}
