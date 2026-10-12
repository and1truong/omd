// Storage/startup coverage across browser engines, independent of native WebMCP.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';

const engine=process.env.OMD_BROWSER??'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4319${basePath}/`;
const sourceRoot=new URL('src/',url).href;
const server=spawn(process.execPath,['scripts/serve.mjs'],{
  cwd:new URL('..',import.meta.url).pathname,
  env:{...process.env,OMD_PORT:'4319',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']
});
let browser,page;
const errors=[];
const ready=async target=>{
  await target.evaluate(async sourceRoot=>{
    const app=window.omdStartupApp=await import(`${sourceRoot}app.js`);await app.ready;
    if(!app.getStore())throw new Error(document.body.innerText);
  },sourceRoot);
  await target.locator('#page-title').waitFor();
};
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true,...(process.env.OMD_BROWSER_EXECUTABLE?{executablePath:process.env.OMD_BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext({viewport:{width:1440,height:1000}});context.setDefaultTimeout(10000);
  const watch=target=>target.on('pageerror',error=>errors.push(error.message));
  page=await context.newPage();watch(page);
  await page.goto(url);await ready(page);
  await page.locator('#page-title').fill('Saved before reopening');
  const saved=await page.evaluate(async()=>{
    const store=window.omdStartupApp.getStore();await store.idle();return store.export();
  });
  // The visible width toggle must resize the actual page and persist without editing content.
  const widthToggle=page.getByRole('button',{name:'Fluid page width',exact:true});
  const paperWidth=async()=> (await page.locator('.paper').boundingBox()).width;
  assert.equal(await widthToggle.innerText(),'Fixed');assert.equal(await paperWidth(),900);
  await widthToggle.click();assert.equal(await widthToggle.innerText(),'Fluid');assert.equal(await paperWidth(),1200);
  await page.setViewportSize({width:1600,height:1000});assert.equal(await paperWidth(),1360);
  await page.reload();await ready(page);
  assert.equal(await widthToggle.innerText(),'Fluid');assert.equal(await widthToggle.getAttribute('aria-pressed'),'true');assert.equal(await paperWidth(),1360);
  assert.equal(await page.locator('#page-title').inputValue(),'Saved before reopening');
  assert.equal(await page.evaluate(()=>window.omdStartupApp.getStore().export()),saved);
  // Keep both choices reachable and within the viewport on the smallest supported screen.
  await page.setViewportSize({width:320,height:700});
  assert.equal(await paperWidth(),320);await widthToggle.click();assert.equal(await widthToggle.innerText(),'Fixed');assert.equal(await paperWidth(),320);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  const toggleBounds=await widthToggle.boundingBox();assert.ok(toggleBounds.x>=0&&toggleBounds.x+toggleBounds.width<=320);
  await widthToggle.focus();await widthToggle.press('Space');assert.equal(await widthToggle.innerText(),'Fluid');assert.equal(await paperWidth(),320);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  await page.setViewportSize({width:1440,height:1000});
  await widthToggle.click();assert.equal(await paperWidth(),900);
  assert.equal(await page.evaluate(()=>window.omdStartupApp.getStore().export()),saved);

  const title=page.locator('#page-title'),subtitle=page.locator('#page-subtitle');
  const titleFocused=()=>title.evaluate(el=>document.activeElement===el);
  const snapshot=()=>page.evaluate(async()=>{
    const store=window.omdStartupApp.getStore();await store.idle();
    return {page:store.getState(),revision:store.getRevision(),history:store.residency().undoEntries};
  });
  const beforeTitle=await snapshot(),newTitle='Tiêu đề đã lưu — Enter thoát';
  // Enter while the input save is pending must not add a newline or a duplicate history entry.
  await title.fill(newTitle);await title.press('Enter');
  await page.waitForFunction(()=>document.activeElement!==document.getElementById('page-title'));
  const afterTitle=await snapshot();assert.equal(afterTitle.page.title,newTitle);
  assert.equal(await title.inputValue(),newTitle);assert.equal(afterTitle.revision,beforeTitle.revision+1);
  assert.equal(afterTitle.history,beforeTitle.history+1);assert.deepEqual(afterTitle.page.blocks,beforeTitle.page.blocks);
  assert.equal(await page.locator('#app-page-title').innerText(),newTitle);
  assert.ok(await page.getByRole('button',{name:`Switch to ${newTitle}`,exact:true}).isVisible());
  // Repeated Enter cannot add history, content, or blocks, even if the textarea is focused again.
  await title.focus();await title.evaluate(el=>{
    for(const repeat of [false,true,false])el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',repeat,bubbles:true,cancelable:true}));
  });
  await page.waitForFunction(()=>document.activeElement!==document.getElementById('page-title'));
  assert.deepEqual(await snapshot(),afterTitle);
  await page.reload();await ready(page);assert.equal(await title.inputValue(),newTitle);
  assert.equal(await page.locator('#app-page-title').innerText(),newTitle);
  assert.ok(await page.getByRole('button',{name:`Switch to ${newTitle}`,exact:true}).isVisible());
  assert.match(await page.locator('#save-status').innerText(),/Saved/);
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  await page.screenshot({path:new URL(`../test-results/title-enter-${engine}-${basePath?'omd':'root'}.png`,import.meta.url).pathname,fullPage:true});

  // Description remains a multiline textarea; title-only handling must not intercept it.
  await subtitle.fill('Dòng một');await subtitle.press('End');await subtitle.press('Enter');await page.keyboard.insertText('Dòng hai');
  assert.equal(await subtitle.inputValue(),'Dòng một\nDòng hai');
  assert.ok(await subtitle.evaluate(el=>document.activeElement===el));
  assert.equal((await snapshot()).page.subtitle,'Dòng một\nDòng hai');

  // Both native IME signals and the composition guard leave confirmation Enter untouched.
  await title.focus();const beforeIme=await snapshot();
  for(const signal of [{isComposing:true},{keyCode:229}]) {
    assert.equal(await title.evaluate((el,signal)=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true,...signal})),signal),true);
    assert.ok(await titleFocused());assert.deepEqual(await snapshot(),beforeIme);
  }
  const composedTitle='Tiếng Việt 日本語';
  assert.equal(await title.evaluate(el=>{
    el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='Tiếng Vi';
    el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
    return el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  }),true);
  assert.ok(await titleFocused());assert.deepEqual(await snapshot(),beforeIme);
  assert.equal(await title.evaluate((el,value)=>{
    el.value=value;el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));
    return el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  },composedTitle),true,'The finishing composition must remain protected through its asynchronous save.');
  assert.ok(await titleFocused());await page.waitForFunction(value=>document.getElementById('app-page-title').textContent===value,composedTitle);
  const settledIme=await snapshot();await title.press('Enter');
  await page.waitForFunction(()=>document.activeElement!==document.getElementById('page-title'));
  assert.deepEqual(await snapshot(),settledIme);assert.equal(settledIme.page.title,composedTitle);

  // A rejected title save keeps the draft and error visible; Enter can retry without an input event.
  const retryTitle='Giữ bản nháp khi lỗi lưu',beforeFailure=await snapshot();
  await page.evaluate(value=>{
    const store=window.omdStartupApp.getStore(),dispatch=store.dispatch;
    window.omdRestoreDispatch=()=>{store.dispatch=dispatch;};
    store.dispatch=(name,input,options)=>name==='set_page'&&input.title===value?Promise.reject(new Error('Injected title save failure')):dispatch(name,input,options);
  },retryTitle);
  await title.fill(retryTitle);await title.press('Enter');
  await page.waitForFunction(()=>document.getElementById('save-status').textContent==='Not saved');
  assert.equal(await title.inputValue(),retryTitle);assert.ok(await titleFocused());assert.deepEqual(await snapshot(),beforeFailure);
  assert.match(await page.locator('#notices').innerText(),/Injected title save failure/);
  await page.screenshot({path:new URL(`../test-results/title-enter-failure-${engine}-${basePath?'omd':'root'}.png`,import.meta.url).pathname,fullPage:true});
  await page.evaluate(()=>window.omdRestoreDispatch());await title.press('Enter');
  await page.waitForFunction(()=>document.activeElement!==document.getElementById('page-title'));
  assert.equal((await snapshot()).page.title,retryTitle);

  // Navigation queued immediately after Enter must not rename the destination page.
  const originalId=(await snapshot()).page.id;
  const otherId=await page.evaluate(async()=>{
    const store=window.omdStartupApp.getStore(),originalId=store.getActivePageId();
    const other=await store.dispatch('page_add',{title:'Other page stays unchanged'});
    await store.dispatch('page_select',{pageId:originalId});return other.pageId;
  });
  await title.evaluate((el,otherId)=>{
    el.focus();el.value='Saved to original page';el.dispatchEvent(new InputEvent('input',{bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
    return window.omdStartupApp.getStore().dispatch('page_select',{pageId:otherId});
  },otherId);
  assert.equal((await snapshot()).page.title,'Other page stays unchanged');
  assert.equal(await title.inputValue(),'Other page stays unchanged');
  assert.equal(await page.evaluate(async pageId=>(await window.omdStartupApp.getStore().getPage(pageId)).title,originalId),'Saved to original page');
  await page.evaluate(pageId=>window.omdStartupApp.getStore().dispatch('page_select',{pageId}),originalId);

  // Imported multiline titles keep their existing rendering and bytes; Enter is not a migration.
  const multiline='Imported first line\nImported second line';
  await page.evaluate(async value=>{
    const store=window.omdStartupApp.getStore(),book=await store.getNotebook();
    book.pages.find(p=>p.id===book.activePageId).title=value;await store.import(JSON.stringify(book));
  },multiline);
  const beforeMultiline=await snapshot();await title.focus();await title.press('Enter');
  await page.waitForFunction(()=>document.activeElement!==document.getElementById('page-title'));
  assert.deepEqual(await snapshot(),beforeMultiline);assert.equal(await title.inputValue(),multiline);
  await page.reload();await ready(page);assert.equal(await title.inputValue(),multiline);
  await title.fill('Saved before reopening');await snapshot();

  // Exercise empty and populated owner indexes, duplicate journal owners, and
  // reclamation without touching the history of another live store.
  const history=await page.evaluate(async sourceRoot=>{
    const {createStore}=await import(`${sourceRoot}store.js`);
    const {openRepository}=await import(`${sourceRoot}repository.js`);
    const {initialNotebook}=await import(`${sourceRoot}notebook.js`);
    const name=`startup-${crypto.randomUUID()}`,storage={getItem:()=>null,setItem:()=>{}};
    const repository=await openRepository(storage,{name,initial:initialNotebook});
    const empty=await repository.historyOwners();repository.close();
    const a=await createStore(storage,{name});
    await a.dispatch('set_page',{title:'First edit'});await a.dispatch('set_page',{title:'Second edit'});
    const opening=indexedDB.open(name);
    const db=await new Promise((resolve,reject)=>{opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);});
    const tx=db.transaction('history','readwrite');
    // Dead sessions can leave several journals with the same owner.
    tx.objectStore('history').put({owner:'abandoned'},'dead-1');
    tx.objectStore('history').put({owner:'abandoned'},'dead-2');
    await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    const inspector=await openRepository(storage,{name});const owners=await inspector.historyOwners();inspector.close();
    const b=await createStore(storage,{name});
    const reading=db.transaction('history').objectStore('history').getAll();
    const rows=await new Promise((resolve,reject)=>{reading.onsuccess=()=>resolve(reading.result);reading.onerror=()=>reject(reading.error);});
    await b.close();await a.undo();const titleAfterUndo=a.getState().title;
    await a.close();db.close();
    return {empty,ownerCount:owners.length,abandonedCount:owners.filter(owner=>owner==='abandoned').length,
      liveJournals:rows.length,hasAbandoned:rows.some(row=>row.owner==='abandoned'),titleAfterUndo,locksAvailable:!!navigator.locks};
  },sourceRoot);
  assert.deepEqual(history.empty,[]);assert.equal(history.ownerCount,2);assert.equal(history.abandonedCount,1);
  assert.ok(history.locksAvailable,'Test must exercise real Web Lock leases.');
  assert.equal(history.liveJournals,2);assert.equal(history.hasAbandoned,false);assert.equal(history.titleAfterUndo,'First edit');

  const peer=await context.newPage();watch(peer);await peer.goto(url);await ready(peer);
  assert.equal(await peer.locator('#page-title').inputValue(),'Saved before reopening');
  // Migration must also work on an origin with saved localStorage notebook data.
  const legacy=await browser.newContext();legacy.setDefaultTimeout(10000);const migrated=await legacy.newPage();watch(migrated);
  await migrated.addInitScript(raw=>localStorage.setItem('omd.notebook.v1',raw),saved);
  await migrated.goto(url);await ready(migrated);
  assert.equal(await migrated.evaluate(()=>window.omdStartupApp.getStore().export()),saved);
  assert.equal(await migrated.evaluate(()=>localStorage.getItem('omd.notebook.v1')),saved);
  await legacy.close();await context.close();
  assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: title Enter/IME/save failure/navigation/multiline, description Enter, fresh startup, saved reload, Fixed/Fluid layout, owner deduplication, live/dead session history and migration passed.`);
}catch(error){
  if(page)console.error({engine,errors,body:(await page.locator('body').innerText()).slice(0,1000)});
  throw error;
}finally{await browser?.close();server.kill();}
