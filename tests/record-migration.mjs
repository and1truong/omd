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
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  for(const version of [1,2,3]){
    const context=await browser.newContext(),page=await context.newPage();
    // A passive same-origin document hosts storage checks without initializing the app first.
    await page.route(`${url}?storage-checks`,route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>IndexedDB migration checks</title>'}));
    await page.goto(`${url}?storage-checks`);
    const {evidence,startup}=await page.evaluate(migrationChecks,{sourceRoot,extension:'js',startupVersion:version});results.push(...evidence);
    // Real app startup must expose the rollback error, retain v1/v2/v3, then retry on reload.
    await page.evaluate(()=>sessionStorage.setItem('migration-fault','once'));
    await page.addInitScript(()=>{
      if(sessionStorage.getItem('migration-fault')!=='once')return;sessionStorage.removeItem('migration-fault');
      const add=IDBObjectStore.prototype.add;let count=0;
      IDBObjectStore.prototype.add=function(...args){if(this.name==='records-v4'&&++count===3)throw new DOMException('startup injected quota','QuotaExceededError');return add.apply(this,args);};
    });
    await page.goto(url);
    await page.waitForFunction(()=>document.body.innerText.includes('upgrade failed'));
    assert.match(await page.locator('body').innerText(),/previous database.*intact.*startup injected quota/);
    const rolledBack=await page.evaluate(()=>new Promise((resolve,reject)=>{const opening=indexedDB.open('omd.notebook.records.v1');opening.onerror=()=>reject(opening.error);opening.onsuccess=()=>{const db=opening.result;const version=db.version,keyPath=db.transaction('records').objectStore('records').keyPath;db.close();resolve({version,keyPath});};}));
    assert.deepEqual(rolledBack,{version,keyPath:null});
    await page.reload();
    const actual=await page.evaluate(async sourceRoot=>{const app=await import(`${sourceRoot}app.js`);await app.ready;if(!app.getStore())throw new Error(document.body.innerText);return app.getStore().getNotebook();},sourceRoot);
    assert.deepEqual(actual,startup);
    await page.reload();
    const reopened=await page.evaluate(async sourceRoot=>{const app=await import(`${sourceRoot}app.js`);await app.ready;return app.getStore().getNotebook();},sourceRoot);assert.deepEqual(reopened,startup);
    results.push({case:`actual app startup v${version} / surfaced rollback error / retry / reopen`,passed:true});
    await context.close();
  }
  await mkdir(new URL('../test-results/',import.meta.url),{recursive:true});
  const path=new URL(`../test-results/record-migration-${engine}-${basePath?'omd':'root'}.json`,import.meta.url);
  await writeFile(path,JSON.stringify({engine,basePath,results},null,2));
  console.log(`PASS: native IndexedDB migrations and startup (${engine}, ${basePath||'/'}), ${results.length} checks; schema evidence: ${path.pathname}`);
}finally{await browser?.close();server.kill();}
