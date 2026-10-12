import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {migrationChecks} from './record-migration-checks.js';
const engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4326${basePath}/`,sourceRoot=new URL('src/',url).href;
assert.ok(['chromium','webkit'].includes(engine));
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,OMD_PORT:'4326',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser;
const results=[];
async function nativeSnapshot(){
  const req=request=>new Promise((resolve,reject)=>{request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  const db=await req(indexedDB.open('omd.notebook.records.v1')),names=[...db.objectStoreNames],tx=db.transaction(names),completed=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);}),stores={};
  await Promise.all(names.map(async name=>{const store=tx.objectStore(name),[keys,values]=await Promise.all([req(store.getAllKeys()),req(store.getAll())]);stores[name]={keyPath:store.keyPath,autoIncrement:store.autoIncrement,indexes:[...store.indexNames].map(n=>({name:n,keyPath:store.index(n).keyPath,unique:store.index(n).unique,multiEntry:store.index(n).multiEntry})),keys,values};}));
  await completed;const result={version:db.version,stores};db.close();return result;
}
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  for(const version of [1,2,3]){
    const context=await browser.newContext(),page=await context.newPage();
    // A passive same-origin document hosts storage checks without initializing the app first.
    await page.route(`${url}?storage-checks`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>IndexedDB migration checks</title>'}));
    await page.goto(`${url}?storage-checks`);
    const {evidence,startup}=await page.evaluate(migrationChecks,{sourceRoot,extension:'js',startupVersion:version});results.push(...evidence);
    // Shipped legacy tabs have no versionchange handler and cannot be closed by the new app.
    const legacy=await context.newPage();await legacy.goto(`${url}manifest.webmanifest`);
    await legacy.evaluate(version=>new Promise((resolve,reject)=>{const opening=indexedDB.open('omd.notebook.records.v1',version);opening.onerror=()=>reject(opening.error);opening.onsuccess=()=>{globalThis.legacyDatabase=opening.result;resolve();};}),version);
    await page.goto(url);await page.waitForFunction(()=>document.body.innerText.includes('upgrade is blocked'));
    assert.match(await page.locator('body').innerText(),/Save.*close all other omd tabs\/windows.*reload.*intact/);
    if(version===3)await page.screenshot({path:new URL(`../test-results/blocked-upgrade-${engine}-${basePath?'omd':'root'}.png`,import.meta.url).pathname,fullPage:true});
    await legacy.close();
    const blocked=await page.evaluate(()=>new Promise((resolve,reject)=>{const opening=indexedDB.open('omd.notebook.records.v1');opening.onerror=()=>reject(opening.error);opening.onsuccess=()=>{const db=opening.result;const version=db.version,keyPath=db.transaction('records').objectStore('records').keyPath;db.close();resolve({version,keyPath});};}));
    assert.deepEqual(blocked,{version,keyPath:null});results.push({case:`actual app v${version} / blocked legacy tab / actionable recovery / late upgrade cancelled`,passed:true});
    // Real app startup must expose the rollback error, retain v1/v2/v3, then retry on reload.
    await page.evaluate(()=>sessionStorage.setItem('migration-fault','once'));
    await page.addInitScript(()=>{
      if(sessionStorage.getItem('migration-fault')!=='once')return;sessionStorage.removeItem('migration-fault');
      const add=IDBObjectStore.prototype.add;let count=0;
      IDBObjectStore.prototype.add=function(...args){if(this.name==='records-v4'&&++count===3)throw new DOMException('startup injected quota','QuotaExceededError');return add.apply(this,args);};
    });
    await page.reload();
    await page.waitForFunction(()=>document.body.innerText.includes('upgrade failed'));
    assert.match(await page.locator('body').innerText(),/previous database.*intact.*startup injected quota/);
    const rolledBack=await page.evaluate(()=>new Promise((resolve,reject)=>{const opening=indexedDB.open('omd.notebook.records.v1');opening.onerror=()=>reject(opening.error);opening.onsuccess=()=>{const db=opening.result;const version=db.version,keyPath=db.transaction('records').objectStore('records').keyPath;db.close();resolve({version,keyPath});};}));
    assert.deepEqual(rolledBack,{version,keyPath:null});
    await page.reload();
    const actual=await page.evaluate(async sourceRoot=>{const app=await import(`${sourceRoot}app.js`);await app.ready;if(!app.getStore())throw new Error(document.body.innerText);return app.getStore().getNotebook();},sourceRoot);
    assert.deepEqual(actual,startup);
    if(version===3)await page.screenshot({path:new URL(`../test-results/blocked-upgrade-recovered-${engine}-${basePath?'omd':'root'}.png`,import.meta.url).pathname,fullPage:true});
    await page.reload();
    const reopened=await page.evaluate(async sourceRoot=>{const app=await import(`${sourceRoot}app.js`);await app.ready;return app.getStore().getNotebook();},sourceRoot);assert.deepEqual(reopened,startup);
    results.push({case:`actual app startup v${version} / surfaced rollback error / retry / reopen`,passed:true});
    await context.close();
  }
  const context=await browser.newContext(),page=await context.newPage();
  await page.route(`${url}?v4-storage-checks`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Native v4 storage checks</title>'}));await page.goto(`${url}?v4-storage-checks`);
  const {evidence,startup,v4}=await page.evaluate(migrationChecks,{sourceRoot,extension:'js',startupVersion:4});results.push(...evidence);
  // A previously installed notebook can hit the same malformed metadata while offline.
  await page.evaluate(async url=>{await navigator.serviceWorker.register(new URL('service-worker.js',url),{scope:new URL(url).pathname});await navigator.serviceWorker.ready;},url);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  for(const offline of [false,true]){
    if(offline){
      // WebKit's emulated offline mode bypasses service workers; cut the real origin instead.
      await new Promise(resolve=>{server.once('exit',resolve);server.kill();});await assert.rejects(()=>fetch(url),/fetch failed/);
    }
    const response=await page.goto(url);if(offline)assert.ok(response.fromServiceWorker(),'Unavailable-origin startup must load from the real service worker cache');await page.waitForFunction(()=>document.body.innerText.includes('metadata is invalid'));
    assert.match(await page.locator('body').innerText(),/database.*recovery sources are intact.*Recover.*reload.*nonempty/);
    assert.ok(await page.getByRole('button',{name:'Download saved data',exact:true}).isVisible());assert.ok(await page.getByRole('button',{name:'Reload app',exact:true}).isVisible());
    assert.deepEqual(await page.evaluate(nativeSnapshot),v4.before);assert.deepEqual(await page.evaluate(()=>Object.entries(localStorage)),v4.sources);
    await page.screenshot({path:new URL(`../test-results/v4-metadata-rejected-${engine}-${basePath?'omd':'root'}-${offline?'offline':'online'}.png`,import.meta.url).pathname,fullPage:true});
  }
  await page.evaluate(async({before,healthy})=>{
    const db=await new Promise((resolve,reject)=>{const opening=indexedDB.open('omd.notebook.records.v1',4);opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);}),tx=db.transaction([...db.objectStoreNames],'readwrite'),completed=new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    for(const [name,saved]of Object.entries(healthy.stores)){const store=tx.objectStore(name),keys=new Set(saved.keys.map(key=>JSON.stringify(key)));for(const key of before.stores[name].keys)if(!keys.has(JSON.stringify(key)))store.delete(key);saved.values.forEach((value,i)=>saved.keyPath===null?store.put(value,saved.keys[i]):store.put(value));}
    await completed;db.close();
  },v4);
  assert.deepEqual(await page.evaluate(nativeSnapshot),v4.healthy);await page.reload();
  const recovered=await page.evaluate(async sourceRoot=>{const app=await import(`${sourceRoot}app.js`);await app.ready;if(!app.getStore())throw new Error(document.body.innerText);return {book:await app.getStore().getNotebook(),pages:app.getStore().listPages().length};},sourceRoot);assert.deepEqual(recovered.book,startup);assert.equal(recovered.pages,2);
  for(const [key,value]of v4.sources)assert.equal(await page.evaluate(key=>localStorage.getItem(key),key),value);
  results.push({case:'actual native v4 startup / inactive empty ID / online+unavailable-origin SW-cache recovery / exact schema+data+history+ledger+source preservation / repair same DB and reload without network',passed:true});await context.close();
  const path=new URL(`../test-results/record-migration-${engine}-${basePath?'omd':'root'}.json`,import.meta.url);
  await writeFile(path,JSON.stringify({engine,basePath,results},null,2));
  console.log(`PASS: native IndexedDB migrations and startup (${engine}, ${basePath||'/'}), ${results.length} checks; schema evidence: ${path.pathname}`);
}finally{await browser?.close();server.kill();}
