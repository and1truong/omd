import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'';
assert.ok(['chromium','webkit'].includes(engine));
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4321',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser,page,blockId;const errors=[];
const call=(name,input={})=>page.evaluate(async({name,input})=>{
  const app=await import(new URL('./src/app.js',document.baseURI).href);await app.flushPending();const store=app.getStore();return name==='undo'?store.undo():name==='redo'?store.redo():store.dispatch(name,input);
},{name,input});
const items=(flush=true)=>page.evaluate(async({blockId,flush})=>{
  const app=await import(new URL('./src/app.js',document.baseURI).href);if(flush)await app.flushPending();const store=app.getStore();
  const {findBlock}=await import(new URL('./src/model.js',document.baseURI).href);return findBlock(store.getState(),blockId,'checklist').block.items;
},{blockId,flush});
const input=id=>page.locator(`[id="${id}"]`);
const host=id=>page.locator(`[data-checklist-editor="${id}"]`);
const row=id=>page.locator(`[data-item-id="${id}"] > .check-row`);
const focused=id=>page.waitForFunction(id=>document.activeElement?.id===id,id);
// Focus can still belong to the old input while its async move is pending.
// Wait for the rendered parent and sibling position before reading saved state.
const placed=(id,parentId,index)=>page.waitForFunction(({id,parentId,index})=>{
  const entry=document.querySelector(`[data-item-id="${id}"]`),list=entry?.parentElement;
  return !!entry&&!!list&&(list.parentElement?.dataset.itemId??'')===parentId&&[...list.children].indexOf(entry)===index;
},{id,parentId,index});
const menu=async id=>{await row(id).getByRole('button',{name:'Checklist item actions',exact:true}).click();return page.locator('#block-actions-dialog');};
const children=(id,flush=true)=>{const visit=items=>{for(const item of items){if(item.id===id)return item.children??[];const found=visit(item.children??[]);if(found)return found;}};return items(flush).then(visit);};
const addChild=async id=>{
  const count=(await children(id)).length;
  await (await menu(id)).getByRole('button',{name:'Add child checklist item',exact:true}).click();
  await page.waitForFunction(({id,count})=>document.querySelector(`[data-item-id="${id}"] > .checklist-items`)?.children.length===count+1,{id,count});
  const child=(await children(id)).at(-1).id;await focused(child);return child;
};
async function ready() {
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://localhost:4321${basePath}/`);
  await page.evaluate(async()=>await (await import(new URL('./src/app.js',document.baseURI).href)).ready);
}
async function fixture() {
  await call('page_add',{title:'Nested checklist'});
  const toggle=(await call('add_block',{type:'toggle',title:'Project'})).block;
  blockId=(await call('add_block',{type:'checklist',containerId:toggle.id,title:'Steps'})).blockId;
  await page.locator(`[data-block-id="${blockId}"]`).getByRole('button',{name:'Add checklist item',exact:true}).click();
  await page.locator(`[data-block-id="${blockId}"] .check-row`).waitFor();
  const first=(await items())[0].id;await focused(first);await input(first).fill('Plan');await input(first).press('Enter');
  await page.waitForFunction(blockId=>document.querySelector(`[data-block-id="${blockId}"] > .checklist-items`)?.children.length===2,blockId);
  const second=(await items())[1].id;await focused(second);await input(second).fill('Build');return [first,second];
}

async function markdownCases() {
  const pageId=(await call('page_add',{title:'Markdown at every checklist level'})).pageId;
  const toggle=(await call('add_block',{type:'toggle',title:'Markdown tasks'})).block;
  blockId=(await call('add_block',{type:'checklist',containerId:toggle.id,title:'Four levels'})).blockId;
  const ids=[],sources=[];
  for(let level=1;level<=4;level++) {
    const text=`Level ${level}: __bold__ and _italic_, \`code\`, [Docs](https://example.com/level-${level})`;
    sources.push(text);ids.push((await call('checklist_add',{blockId,parentId:ids.at(-1),text})).itemId);
  }
  const [rootItem,child,,leaf]=ids;
  const exported=()=>page.evaluate(async()=>{const app=await import(new URL('./src/app.js',document.baseURI).href);await app.flushPending();return app.getStore().export();});
  const original=await items();
  for(const [index,id] of ids.entries()) {
    assert.equal(await input(id).getAttribute('contenteditable'),'true');
    assert.equal(await input(id).locator('strong').innerText(),'bold');assert.equal(await input(id).locator('em').innerText(),'italic');assert.equal(await input(id).locator('code').innerText(),'code');
    assert.equal(await input(id).evaluate(el=>el.closest('[data-item-id]').dataset.level),String(index+1));
    await input(id).hover();await input(id).focus();
    assert.equal(await host(id).locator('[role=toolbar],.markdown-toolbar,.markdown-tool').count(),0);
    assert.equal(await input(id).locator('a').getAttribute('target'),'_blank');assert.match(await input(id).locator('a').getAttribute('rel'),/noopener/);
  }
  // Merely mounting/focusing/importing Markdown must retain the exact source spelling.
  const json=await exported();await page.evaluate(async json=>{const app=await import(new URL('./src/app.js',document.baseURI).href);await app.getStore().import(json);},json);
  assert.deepEqual(await items(),original);
  const visit=(items,id)=>{for(const item of items){if(item.id===id)return item;const found=visit(item.children??[],id);if(found)return found;}};
  const importedItems=JSON.parse(await exported()).pages.find(p=>p.id===pageId).blocks[0].blocks[0].items;
  assert.deepEqual(ids.map(id=>visit(importedItems,id).text),sources);

  await input(rootItem).evaluate(el=>{el.focus();window.omdChecklistIdentity=el;window.omdChecklistEditor=el.editor;const node=el.querySelector('p').firstChild;getSelection().setBaseAndExtent(node,2,node,5);});
  await call('checklist_update',{blockId,itemId:leaf,patch:{done:true}});
  assert.deepEqual(await input(rootItem).evaluate(el=>[el===window.omdChecklistIdentity,el.editor===window.omdChecklistEditor,document.activeElement===el,getSelection().anchorOffset,getSelection().focusOffset]),[true,true,true,2,5]);
  assert.equal(await row(leaf).getByRole('checkbox').isChecked(),true);assert.equal(await row(rootItem).getByRole('checkbox').isChecked(),false);
  assert.equal(await page.locator(`[data-block-id="${blockId}"] .checklist-progress`).innerText(),'1 / 4');
  assert.deepEqual((await items()).map(item=>item.text),[sources[0]]);

  await page.context().route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Safe destination</title><p>Checklist link</p>'}));
  for(const id of ids) {
    const before=await items(),url=page.url();await page.waitForTimeout(550);
    const [destination]=await Promise.all([page.waitForEvent('popup'),input(id).locator('a').click()]);await destination.waitForLoadState();
    assert.deepEqual(await destination.evaluate(()=>[window.opener,document.referrer]),[null,'']);await destination.close();
    assert.equal(page.url(),url);assert.deepEqual(await items(),before);
  }
  await input(leaf).fill('');await input(leaf).evaluate(el=>{el.focus();const clipboardData=new DataTransfer();clipboardData.setData('text/plain','**Pasted** *note* \`code\` [Docs](https://example.com/paste)\n\n- one\n- two');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData}));});
  assert.equal(await input(leaf).locator('strong').innerText(),'Pasted');assert.equal(await input(leaf).locator('li').count(),2);
  const pasted=visit(await items(),leaf).text;assert.match(pasted,/\*\*Pasted\*\*/);assert.match(pasted,/- one/);
  await input(leaf).press('Control+z');assert.equal(visit(await items(),leaf).text,'');
  await input(leaf).press('Control+Shift+z');assert.equal(visit(await items(),leaf).text,pasted);
  // Markdown lists stay within the item; both Enter variants still create checklist siblings.
  await input(leaf).press('Shift+Enter');await page.waitForFunction(id=>document.querySelector(`[data-item-id="${id}"]`).parentElement.children.length===2,leaf);
  const sibling=(await children(ids[2]))[1].id;await focused(sibling);assert.equal(visit(await items(),leaf).text,pasted);
  await input(sibling).fill('New sibling');await input(sibling).press('Tab');await page.waitForTimeout(100);
  assert.equal((await children(ids[2])).length,2,'Unavailable indent must not indent a Markdown list or exceed depth 4.');
  await call('checklist_remove',{blockId,itemId:sibling});

  await call('checklist_update',{blockId,itemId:leaf,patch:{text:'Before composition'}});
  await input(leaf).evaluate(el=>{
    el.focus();window.omdComposedChecklist=el;el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    el.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Đang gõ tiếng Việt'}));el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
    for(const key of ['Enter','Tab'])el.dispatchEvent(new KeyboardEvent('keydown',{key,shiftKey:true,isComposing:true,bubbles:true,cancelable:true}));
  });
  await page.evaluate(async({blockId,itemId})=>(await import(new URL('./src/app.js',document.baseURI).href)).getStore().dispatch('checklist_update',{blockId,itemId,patch:{text:'External edit during composition'}}),{blockId,itemId:leaf});
  assert.equal(await input(leaf).innerText(),'Đang gõ tiếng Việt');assert.equal((await children(ids[2],false)).length,1);
  await page.evaluate(async()=>{
    const store=(await import(new URL('./src/app.js',document.baseURI).href)).getStore(),dispatch=store.dispatch;
    store.dispatch=async(name,input,options)=>{
      if(name==='checklist_update'&&input.patch?.text==='Đang gõ tiếng Việt') {window.omdCompositionSaving=true;await new Promise(resolve=>{window.omdFinishComposition=resolve;});}
      return dispatch(name,input,options);
    };
    window.omdRestoreChecklistDispatch=()=>{store.dispatch=dispatch;};
  });
  await input(leaf).evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
  await page.waitForFunction(()=>window.omdCompositionSaving);
  await input(leaf).evaluate(el=>{el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',shiftKey:true,bubbles:true,cancelable:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true}));});
  assert.equal(await input(leaf).evaluate(el=>el===window.omdComposedChecklist&&el.isConnected),true);
  await input(leaf).evaluate(el=>el.editor.chain().setTextSelection(el.editor.state.doc.content.size-1).insertContent(' tiếp').run());
  await page.evaluate(()=>{window.omdRestoreChecklistDispatch();window.omdFinishComposition();});await items();
  await page.waitForFunction(id=>!document.getElementById(id).editor.view.composing,leaf);
  assert.equal(visit(await items(),leaf).text,'Đang gõ tiếng Việt tiếp');assert.equal((await children(ids[2])).length,1);

  // An actual database write error retains the draft/instance and blocks destructive actions until retry.
  await input(leaf).focus();await page.evaluate(blockId=>{
    const put=IDBObjectStore.prototype.put;window.omdRestoreChecklistPut=()=>{IDBObjectStore.prototype.put=put;};
    IDBObjectStore.prototype.put=function(value,...args){if(this.name==='records'&&value?.data?.id===blockId)throw new Error('Injected checklist storage failure');return put.call(this,value,...args);};
  },blockId);
  await input(leaf).fill('Draft retained after storage failure');await page.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');
  assert.match(await page.locator('#notices').innerText(),/Injected checklist storage failure/);
  assert.equal(await input(leaf).innerText(),'Draft retained after storage failure');assert.equal(await input(leaf).evaluate(el=>el===window.omdComposedChecklist&&el.isConnected),true);
  await input(leaf).press('Enter');await page.waitForTimeout(100);await assert.rejects(()=>items(),/Injected checklist storage failure/);
  assert.equal(await page.locator(`[data-item-id="${ids[2]}"] > .checklist-items > .checklist-item`).count(),1);
  await page.evaluate(()=>window.omdRestoreChecklistPut());await items();assert.equal(visit(await items(),leaf).text,'Draft retained after storage failure');

  await call('checklist_update',{blockId,itemId:child,patch:{text:'[Unsafe](javascript:alert(1)) <script>window.omdChecklistInjected=true</script> <img src=x onerror="window.omdChecklistInjected=true">'}});
  assert.equal(await input(child).locator('script,img,[onerror],a[href^="javascript:"]').count(),0);assert.equal(await page.evaluate(()=>window.omdChecklistInjected),undefined);
  const secure=await items();await page.reload();await page.evaluate(async()=>await (await import(new URL('./src/app.js',document.baseURI).href)).ready);assert.deepEqual(await items(),secure);
  // Hidden, removed and page-switched checklist editors release their resources.
  await input(leaf).evaluate(el=>{window.omdHiddenChecklist=el.editor;});await call('update_block',{blockId:toggle.id,patch:{open:false}});
  assert.equal(await page.evaluate(()=>window.omdHiddenChecklist.isDestroyed),true);assert.equal(await host(leaf).count(),0);
  await call('update_block',{blockId:toggle.id,patch:{open:true}});assert.deepEqual(await items(),secure);
  await input(leaf).evaluate(el=>{window.omdRemovedChecklist=el.editor;});await call('checklist_remove',{blockId,itemId:leaf});assert.equal(await page.evaluate(()=>window.omdRemovedChecklist.isDestroyed),true);
  await call('undo');assert.deepEqual(await items(),secure);
  await input(leaf).evaluate(el=>{window.omdNavigatedChecklist=el.editor;});await call('page_add',{title:'Away'});assert.equal(await page.evaluate(()=>window.omdNavigatedChecklist.isDestroyed),true);
  await call('page_select',{pageId});assert.deepEqual(await items(),secure);
}

try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(10000);
  page=await context.newPage();await ready();const [first,second]=await fixture();

  await input(second).press('Tab');await placed(second,first,0);await focused(second);assert.equal((await children(first))[0].id,second);
  await input(second).press('Shift+Tab');await placed(second,'',1);await focused(second);assert.deepEqual((await items()).map(i=>i.id),[first,second]);
  const child=await addChild(second);await input(child).fill('Child');
  const grandchild=await addChild(child);await input(grandchild).fill('Grandchild');
  const leaf=await addChild(grandchild);await input(leaf).fill('Leaf');
  assert.equal(await input(leaf).evaluate(el=>el.closest('[data-item-id]').dataset.level),'4');
  let actions=await menu(leaf);
  assert.equal(await actions.getByRole('button',{name:'Add child checklist item',exact:true}).isDisabled(),true);
  assert.equal(await actions.getByRole('button',{name:'Indent checklist item',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');
  actions=await menu(second);assert.equal(await actions.getByRole('button',{name:'Indent checklist item',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');
  await input(second).press('Tab');assert.equal((await items()).length,2,'A four-level branch cannot be indented.');

  // Enter creates a sibling at level 4, and sibling arrows preserve the parent.
  await input(leaf).press('Enter');
  await page.waitForFunction(id=>document.querySelector(`[data-item-id="${id}"] > .checklist-items`)?.children.length===2,grandchild);
  const sibling=(await children(grandchild))[1].id;await focused(sibling);await input(sibling).fill('Sibling');
  await row(sibling).getByRole('button',{name:'Move checklist item up',exact:true}).click();await placed(sibling,grandchild,0);await focused(sibling);
  assert.deepEqual((await children(grandchild)).map(i=>i.id),[sibling,leaf]);
  await row(sibling).getByRole('button',{name:'Move checklist item down',exact:true}).click();await placed(sibling,grandchild,1);await focused(sibling);
  assert.deepEqual((await children(grandchild)).map(i=>i.id),[leaf,sibling]);
  await row(leaf).getByRole('checkbox').check();
  await page.waitForFunction(blockId=>document.querySelector(`[data-block-id="${blockId}"] .checklist-progress`)?.textContent==='1 / 6',blockId);
  assert.equal(await page.locator(`[data-block-id="${blockId}"] .checklist-progress`).textContent(),'1 / 6');
  assert.equal(await row(grandchild).getByRole('checkbox').isChecked(),false);

  // Outdent and indent move the full branch while preserving focus.
  await input(grandchild).press('Shift+Tab');await placed(grandchild,second,1);await focused(grandchild);
  assert.deepEqual((await children(second)).map(i=>i.id),[child,grandchild]);
  await input(grandchild).press('Tab');await placed(grandchild,child,0);await focused(grandchild);assert.equal((await children(child))[0].id,grandchild);

  // Composition Enter must not add an item before committing text.
  const before=await items();
  await input(leaf).evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  assert.deepEqual(await items(),before);
  await mkdir(`${root}/test-results`,{recursive:true});await page.screenshot({path:`${root}/test-results/checklist-${engine}-desktop.png`});
  await row(second).getByRole('button',{name:'Delete checklist item',exact:true}).click();await input(second).waitFor({state:'detached'});assert.equal((await items()).length,1);
  await call('undo');assert.deepEqual(await items(),before);await call('redo');assert.equal((await items()).length,1);await call('undo');
  await page.reload();await page.evaluate(async()=>await (await import(new URL('./src/app.js',document.baseURI).href)).ready);assert.deepEqual(await items(),before);
  await markdownCases();await context.close();

  // Touch controls and four levels fit even the smallest supported viewport.
  const mobile=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true});mobile.setDefaultTimeout(10000);
  page=await mobile.newPage();await ready();const [,parent]=await fixture();
  const nested=await addChild(parent),deep=await addChild(nested),last=await addChild(deep);await input(last).fill('Deep mobile task');
  actions=await menu(last);assert.equal(await actions.getByRole('button',{name:'Add child checklist item',exact:true}).isDisabled(),true);
  await actions.getByRole('button',{name:'Outdent checklist item',exact:true}).tap();await placed(last,nested,1);await focused(last);assert.equal((await children(nested))[1].id,last);
  actions=await menu(last);await actions.getByRole('button',{name:'Indent checklist item',exact:true}).tap();await placed(last,deep,0);await focused(last);assert.equal((await children(deep))[0].id,last);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Nested checklist controls must fit mobile.');
  assert.ok((await input(last).boundingBox()).width>0,'Deep item text must remain editable.');
  assert.deepEqual(await input(deep).evaluate(el=>{const placeholder=getComputedStyle(el.querySelector('p'),'::before');return [placeholder.whiteSpace,placeholder.textOverflow,placeholder.overflowX];}),['nowrap','ellipsis','hidden']);
  await call('checklist_update',{blockId,itemId:last,patch:{text:'**Deep** *mobile* [Docs](https://example.com/mobile)'}});
  assert.equal(await input(last).locator('strong').innerText(),'Deep');await input(last).tap();assert.equal(await host(last).locator('[role=toolbar],.markdown-tool').count(),0);
  await input(last).press('Control+End');await page.keyboard.type('!');assert.match(await input(last).innerText(),/!$/);assert.match((await children(deep))[0].text,/\[Docs!\]/);
  await mobile.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Mobile checklist link</title>'}));
  const beforeTap=await items();await page.waitForTimeout(550);
  const [destination]=await Promise.all([page.waitForEvent('popup'),input(last).locator('a').tap()]);await destination.waitForLoadState();
  assert.deepEqual(await destination.evaluate(()=>[window.opener,document.referrer]),[null,'']);await destination.close();assert.deepEqual(await items(),beforeTap);
  await page.screenshot({path:`${root}/test-results/checklist-${engine}-mobile.png`});
  await mobile.close();assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: checklist Markdown/no-toolbar at four levels, source round-trip, safe links/paste/lists, nesting, keyboard/touch, composition lifetime, identity/caret, storage-failure retry, lifecycle, history and persistence passed.`);
} finally {await browser?.close();server.kill();}
