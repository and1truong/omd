// Storage/startup coverage across browser engines, independent of native WebMCP.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';

const engine=process.env.OMD_BROWSER??'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4319${basePath}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{
  cwd:new URL('..',import.meta.url).pathname,
  env:{...process.env,OMD_PORT:'4319',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']
});
let browser,page;
const errors=[];
const ready=async target=>{
  await target.evaluate(async()=>{
    const app=await import(new URL('./src/app.js',document.baseURI).href);await app.ready;
    if(!app.getStore())throw new Error(document.body.innerText);
  });
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
    const store=(await import(new URL('./src/app.js',document.baseURI).href)).getStore();await store.idle();return store.export();
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
  assert.equal(await page.evaluate(async()=>(await import(new URL('./src/app.js',document.baseURI).href)).getStore().export()),saved);
  // Keep both choices reachable and within the viewport on the smallest supported screen.
  await page.setViewportSize({width:320,height:700});
  assert.equal(await paperWidth(),320);await widthToggle.click();assert.equal(await widthToggle.innerText(),'Fixed');assert.equal(await paperWidth(),320);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  const toggleBounds=await widthToggle.boundingBox();assert.ok(toggleBounds.x>=0&&toggleBounds.x+toggleBounds.width<=320);
  await widthToggle.focus();await widthToggle.press('Space');assert.equal(await widthToggle.innerText(),'Fluid');assert.equal(await paperWidth(),320);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth),320);
  await page.setViewportSize({width:1440,height:1000});
  await widthToggle.click();assert.equal(await paperWidth(),900);
  assert.equal(await page.evaluate(async()=>(await import(new URL('./src/app.js',document.baseURI).href)).getStore().export()),saved);

  // Exercise empty and populated owner indexes, duplicate journal owners, and
  // reclamation without touching the history of another live store.
  const history=await page.evaluate(async()=>{
    const {createStore}=await import(new URL('./src/store.js',document.baseURI).href);
    const {openRepository}=await import(new URL('./src/repository.js',document.baseURI).href);
    const {initialNotebook}=await import(new URL('./src/notebook.js',document.baseURI).href);
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
  });
  assert.deepEqual(history.empty,[]);assert.equal(history.ownerCount,2);assert.equal(history.abandonedCount,1);
  assert.ok(history.locksAvailable,'Test must exercise real Web Lock leases.');
  assert.equal(history.liveJournals,2);assert.equal(history.hasAbandoned,false);assert.equal(history.titleAfterUndo,'First edit');

  const peer=await context.newPage();watch(peer);await peer.goto(url);await ready(peer);
  assert.equal(await peer.locator('#page-title').inputValue(),'Saved before reopening');
  // Migration must also work on an origin with saved localStorage notebook data.
  const legacy=await browser.newContext();legacy.setDefaultTimeout(10000);const migrated=await legacy.newPage();watch(migrated);
  await migrated.addInitScript(raw=>localStorage.setItem('omd.notebook.v1',raw),saved);
  await migrated.goto(url);await ready(migrated);
  assert.equal(await migrated.evaluate(async()=>(await import(new URL('./src/app.js',document.baseURI).href)).getStore().export()),saved);
  assert.equal(await migrated.evaluate(()=>localStorage.getItem('omd.notebook.v1')),saved);
  await legacy.close();await context.close();
  assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: fresh startup, saved reload, Fixed/Fluid layout, owner deduplication, live/dead session history and migration passed.`);
}catch(error){
  if(page)console.error({engine,errors,body:(await page.locator('body').innerText()).slice(0,1000)});
  throw error;
}finally{await browser?.close();server.kill();}
