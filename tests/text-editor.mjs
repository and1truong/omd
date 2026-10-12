import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'';
assert.ok(['chromium','webkit'].includes(engine));
const startServer=()=>spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4322',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let server=startServer();
const listening=()=>new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
let browser,page;const errors=[];
const call=(name,input={})=>page.evaluate(async({name,input})=>{
  const app=await import('./src/app.js');await app.flushPending();const store=app.getStore();
  return name==='undo'?store.undo():name==='redo'?store.redo():store.dispatch(name,input);
},{name,input});
const state=()=>page.evaluate(async()=>{const app=await import('./src/app.js');await app.flushPending();return app.getStore().getState();});
const box=id=>page.locator(`[id="${id}-text"]`);
const host=id=>page.locator(`[data-text-editor="${id}"]`);
const focused=id=>page.waitForFunction(id=>document.activeElement?.id===`${id}-text`&&document.activeElement.isContentEditable,id);
// Playwright polls synchronous return values; a Promise would pass immediately.
const readers=()=>page.evaluate(async()=>{
  const app=await import('./src/app.js'),model=await import('./src/model.js');
  window.omdEditorTest={text:id=>model.findBlock(app.getStore().getState(),id).block.text,order:id=>model.findContainer(app.getStore().getState(),id).blocks.map(b=>b.id)};
});
const saved=async(id,text)=>{
  await readers();try{await page.waitForFunction(({id,text})=>window.omdEditorTest.text(id)===text,{id,text});}
  catch(error){console.error({expected:text,actual:await page.evaluate(id=>window.omdEditorTest.text(id),id)});throw error;}
};
const order=containerId=>page.evaluate(async containerId=>{
  const app=await import('./src/app.js'),{findContainer}=await import('./src/model.js');return findContainer(app.getStore().getState(),containerId).blocks.map(b=>b.id);
},containerId);
async function ready() {
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://localhost:4322${basePath}/`);
  await page.evaluate(async()=>await (await import('./src/app.js')).ready);
}
async function nextBlock(id,containerId='page') {
  const before=await order(containerId);await box(id).press('Shift+Enter');
  await readers();await page.waitForFunction(({id,containerId,before})=>{
    const ids=window.omdEditorTest.order(containerId);
    const next=ids[ids.indexOf(id)+1];return ids.length===before.length+1&&typeof next==='string'&&!before.includes(next);
  },{id,containerId,before});
  const after=await order(containerId),created=after[after.indexOf(id)+1];
  assert.equal(typeof created,'string',JSON.stringify({id,containerId,before,after}));await focused(created);
  assert.deepEqual(after,[...before.slice(0,before.indexOf(id)+1),created,...before.slice(before.indexOf(id)+1)]);return created;
}

try {
  await listening();
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(10000);
  page=await context.newPage();await ready();await call('page_add',{title:'Markdown and next blocks'});
  const pageId=(await state()).id;
  const first=(await call('add_block',{type:'text',text:'Keep the whole original paragraph'})).blockId;
  const following=(await call('add_block',{type:'text',text:'Already here'})).blockId;

  // Shift+Enter works in the middle of a paragraph without splitting its content.
  await box(first).focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowRight');
  const next=await nextBlock(first);assert.equal((await state()).blocks[0].text,'Keep the whole original paragraph');
  assert.equal((await state()).blocks[1].text,'');assert.equal((await state()).blocks[2].id,following);
  assert.equal(await page.evaluate(()=>getSelection().isCollapsed),true);
  assert.equal(await page.evaluate(()=>getSelection().anchorOffset),0);
  await box(next).press('Control+z');await box(next).waitFor({state:'detached'});assert.deepEqual(await order('page'),[first,following]);
  await page.locator('#redo-button').click();await box(next).waitFor();assert.deepEqual(await order('page'),[first,next,following]);
  await box(next).fill('Cursor moved here');await saved(next,'Cursor moved here');

  // Enter retains paragraphs within a block; Shift+Enter reserves the new-block shortcut.
  await box(next).press('End');await box(next).press('Enter');await page.keyboard.type('Another paragraph');
  await saved(next,'Cursor moved here\n\nAnother paragraph');assert.equal((await order('page')).length,3);
  assert.equal(await box(next).locator('p').count(),2);

  const markdown='# A heading\n\n**Bold** and *italic* with `code`.\n\n- First\n- Second\n\n> A quote\n\n```js\nconst idea = 1;\n```\n\n[Docs](https://example.com)';
  await call('update_block',{blockId:first,patch:{text:markdown}});
  assert.equal(await box(first).locator('h1').innerText(),'A heading');assert.equal(await box(first).locator('strong').innerText(),'Bold');
  assert.equal(await box(first).locator('em').innerText(),'italic');assert.equal(await box(first).locator('ul > li').count(),2);
  assert.equal(await box(first).locator('blockquote').innerText(),'A quote');assert.match(await box(first).locator('pre').innerText(),/const idea = 1/);
  assert.equal(await box(first).locator('a').getAttribute('href'),'https://example.com');
  assert.equal((await state()).blocks[0].text,markdown,'Loading Markdown must not rewrite the saved source.');

  await box(next).fill('Format this');await saved(next,'Format this');await box(next).press('Control+a');
  await host(next).getByRole('button',{name:'Bold',exact:true}).click();await saved(next,'**Format this**');
  assert.equal(await box(next).locator('strong').innerText(),'Format this');
  await box(next).press('Control+z');await saved(next,'Format this');await box(next).press('Control+Shift+z');await saved(next,'**Format this**');
  await call('update_block',{blockId:next,patch:{text:''}});await box(next).pressSequentially('## A thought');await saved(next,'## A thought');
  assert.equal(await box(next).locator('h2').innerText(),'A thought');
  await box(following).fill('');await box(following).evaluate(el=>{
    const clipboardData=new DataTransfer();clipboardData.setData('text/plain','### Pasted heading\n\n**From clipboard**');
    el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));
  });
  await saved(following,'### Pasted heading\n\n**From clipboard**');
  assert.equal(await box(following).locator('h3').innerText(),'Pasted heading');assert.equal(await box(following).locator('strong').innerText(),'From clipboard');

  // Cached rich editors and their selection survive unrelated block changes.
  await box(next).focus();await page.evaluate(id=>{
    window.omdTextIdentity=document.getElementById(`${id}-text`);const node=window.omdTextIdentity.querySelector('h2').firstChild;getSelection().setBaseAndExtent(node,2,node,5);
  },next);
  await call('update_block',{blockId:following,patch:{text:'Unrelated update'}});
  assert.deepEqual(await page.evaluate(()=>[window.omdTextIdentity.isConnected,document.activeElement===window.omdTextIdentity,getSelection().anchorOffset,getSelection().focusOffset]),[true,true,2,5]);

  // Composition cannot create a new block, and the user's final text wins an external edit.
  const count=(await order('page')).length;
  await box(next).evaluate(el=>{
    el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    el.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Đang gõ tiếng Việt'}));
    el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,isComposing:true,bubbles:true,cancelable:true}));
  });
  await call('update_block',{blockId:next,patch:{text:'External edit during composition'}});
  assert.equal(await box(next).innerText(),'Đang gõ tiếng Việt');assert.equal((await order('page')).length,count);
  await box(next).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));await saved(next,'Đang gõ tiếng Việt');
  assert.equal((await order('page')).length,count);

  for(const type of ['tabs','toggle','accordion']) {
    const parent=(await call('add_block',{type})).block,containerId=type==='tabs'?parent.tabs[0].id:type==='toggle'?parent.id:parent.items[0].id;
    const child=(await call('add_block',{type:'text',containerId,text:'Nested text'})).blockId;
    const after=(await call('add_block',{type:'divider',containerId})).blockId;
    const created=await nextBlock(child,containerId);assert.deepEqual(await order(containerId),[child,created,after]);
    await box(created).fill('In the same section');await saved(created,'In the same section');
    await call('remove_block',{blockId:parent.id});await box(child).waitFor({state:'detached'});
  }
  const tabs=(await call('add_block',{type:'tabs'})).block;
  const hidden=(await call('add_block',{type:'text',containerId:tabs.tabs[0].id,text:'Saved before hiding'})).blockId;
  await box(hidden).fill('Saved on tab switch');await call('tab_select',{blockId:tabs.id,tabId:tabs.tabs[1].id});await box(hidden).waitFor({state:'detached'});
  await call('tab_select',{blockId:tabs.id,tabId:tabs.tabs[0].id});assert.equal(await box(hidden).innerText(),'Saved on tab switch');

  await call('update_block',{blockId:following,patch:{text:'<script>window.omdUnsafe=true</script>\n\n[unsafe](javascript:alert(1))'}});
  assert.equal(await page.evaluate(()=>window.omdUnsafe),undefined);assert.equal(await box(following).locator('script,a[href^="javascript:"]').count(),0);
  await call('update_block',{blockId:following,patch:{text:'A safe final note'}});
  await mkdir(`${root}/test-results`,{recursive:true});await page.screenshot({path:`${root}/test-results/text-editor-${engine}-desktop.png`});
  const exported=await page.evaluate(async()=>(await import('./src/app.js')).getStore().export());
  await call('page_add',{title:'Another page'});await call('page_select',{pageId});
  assert.equal(await box(next).innerText(),'Đang gõ tiếng Việt');
  await page.reload();await page.evaluate(async()=>await (await import('./src/app.js')).ready);
  assert.equal(await box(first).locator('h1').innerText(),'A heading');assert.equal(await box(next).innerText(),'Đang gõ tiếng Việt');
  assert.equal(JSON.parse(exported).pages.find(p=>p.id===pageId).blocks[0].text,markdown);

  // All editor dependencies must be cached for actual offline editing.
  await page.evaluate(async()=>{await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));});
  // Stop the real server: WebKit's emulated offline mode can reject navigation
  // before dispatching the service-worker fetch event.
  const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;
  await page.reload();await page.evaluate(async()=>await (await import('./src/app.js')).ready);
  await box(next).fill('Edited offline');await saved(next,'Edited offline');await context.close();
  server=startServer();await listening();

  const mobile=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true});mobile.setDefaultTimeout(10000);
  page=await mobile.newPage();await ready();await call('page_add',{title:'Mobile Markdown'});
  const small=(await call('add_block',{type:'text',text:'Write on a small screen'})).blockId;
  const mobileNext=await nextBlock(small);await box(mobileNext).fill('Mobile text');await saved(mobileNext,'Mobile text');
  await box(mobileNext).evaluate(el=>{el.editor.commands.selectAll();el.editor.view.focus();});
  assert.equal(await page.evaluate(()=>getSelection().toString().trimEnd()),'Mobile text');
  await host(mobileNext).getByRole('button',{name:'Italic',exact:true}).tap();await saved(mobileNext,'*Mobile text*');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'The formatting toolbar must fit at 320px.');
  await page.screenshot({path:`${root}/test-results/text-editor-${engine}-mobile.png`});await mobile.close();assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: Tiptap Markdown, next-block focus/order, nested insertion, history, composition, security, persistence, offline and mobile passed.`);
} catch(error) {
  if(page&&!page.isClosed())console.error(await page.evaluate(()=>({active:document.activeElement?.id,editors:[...document.querySelectorAll('[contenteditable=true]')].map(el=>el.id),notices:document.getElementById('notices')?.textContent})));
  throw error;
} finally {await browser?.close();server.kill();}
