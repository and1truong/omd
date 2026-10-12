import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'';
const root=new URL('..',import.meta.url).pathname,url=`http://localhost:4321${basePath}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4321',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser;
const errors=[];
const date='2026-10-12T00:00:00.000Z';
const legacyPage=(id,theme)=>({format:'omd',version:1,id,revision:0,title:`Legacy ${theme} page`,subtitle:'Theme is now global, not a page setting.',theme,notificationMode:'toast',updatedAt:date,blocks:[
  {id:`text-${id}`,type:'text',text:'Both legacy pages keep the same global appearance.'},
  {id:`mermaid-${id}`,type:'mermaid',title:'Global theme diagram',source:'flowchart LR\n Global --> EveryPage'},
  {id:`canvas-${id}`,type:'excalidraw',title:'Global theme canvas',scene:{elements:[],appState:{},files:{}}}
]});
const book={format:'omd-notebook',version:3,id:'theme-notebook',revision:0,activePageId:'old-dark',updatedAt:date,parents:{'old-dark':'','old-light':''},pages:[legacyPage('old-dark','dark'),legacyPage('old-light','light')]};
const ready=target=>target.evaluate(async()=>{const app=await import('./src/app.js');await app.ready;if(!app.getStore())throw new Error(document.body.innerText);});
const call=(target,name,input={})=>target.evaluate(async({name,input})=>{const app=await import('./src/app.js'),{createTools}=await import('./src/webmcp.js');return createTools(app.getStore(),{getView:app.getView,setView:app.setView,flushPending:app.flushPending}).find(t=>t.name===`omd_${name}`).execute(input);},{name,input});
const settle=target=>target.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame);const app=await import('./src/app.js');await app.flushPending();await app.getStore().idle();});
const snapshot=target=>target.evaluate(async()=>{const app=await import('./src/app.js');await app.flushPending();const store=app.getStore();await store.idle();return {json:await store.export(),revision:store.getRevision(),history:store.residency().undoEntries,active:store.getActivePageId()};});
const expectTheme=async(target,mode,resolved)=>{await target.waitForFunction(({mode,resolved})=>document.documentElement.dataset.theme===resolved&&document.getElementById('theme').value===mode,{mode,resolved});assert.equal((await call(target,'get_view')).theme,mode);};
const diagrams=async(target,id,resolved)=>{await target.locator(`[data-block-id="mermaid-${id}"] [data-mermaid-preview] svg`).waitFor({state:'attached'});await target.locator(`[data-diagram-block="canvas-${id}"] .excalidraw canvas`).first().waitFor();await target.waitForFunction(({id,resolved})=>document.querySelector(`[data-diagram-block="canvas-${id}"] .excalidraw`).classList.contains('theme--dark')===(resolved==='dark'),{id,resolved});await settle(target);};
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1440,height:1000},colorScheme:'light'});context.setDefaultTimeout(15000);
  const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(book=>{if(!localStorage.getItem('omd.notebook.v1')){localStorage.setItem('omd.notebook.v1',JSON.stringify(book));localStorage.setItem('omd.view.v1',JSON.stringify({sidebarOpen:true,contentWidth:'reading',collapsedPageIds:[]}));}},book);
  await page.goto(url);await ready(page);await expectTheme(page,'dark','dark');await diagrams(page,'old-dark','dark');
  assert.equal(await page.evaluate(()=>localStorage.getItem('omd.notebook.v1')),JSON.stringify(book));
  await page.getByRole('button',{name:'Switch to Legacy light page',exact:true}).click();await settle(page);await expectTheme(page,'dark','dark');await diagrams(page,'old-light','dark');
  await mkdir(`${root}/test-results`,{recursive:true});
  const evidence=`${root}/test-results/theme-${engine}-${basePath?'omd':'root'}`;
  await page.screenshot({path:`${evidence}-light-page-dark-mode.png`});
  await page.getByRole('button',{name:'Switch to Legacy dark page',exact:true}).click();await settle(page);await diagrams(page,'old-dark','dark');
  await page.screenshot({path:`${evidence}-dark-page-dark-mode.png`});
  const stored=JSON.parse((await snapshot(page)).json);assert.deepEqual(stored.pages.map(p=>p.theme),['dark','light']);
  const newPage=await call(page,'page_add',{title:'Created under global theme'});await expectTheme(page,'dark','dark');await call(page,'page_remove',{pageId:newPage.pageId});await expectTheme(page,'dark','dark');
  await call(page,'page_select',{pageId:'old-dark'});await diagrams(page,'old-dark','dark');
  const peer=await context.newPage();peer.on('pageerror',error=>errors.push(error.message));await peer.goto(url);await ready(peer);await diagrams(peer,'old-dark','dark');
  await peer.evaluate(async()=>{const app=await import('./src/app.js');await app.openCanvas('canvas-old-dark');});
  const before=await snapshot(page),peerBefore=await snapshot(peer);
  const mermaidDark=await page.locator('[data-mermaid-preview] svg .node rect').first().evaluate(node=>getComputedStyle(node).fill);
  await page.evaluate(()=>document.getElementById('settings-dialog').showModal());await page.locator('#theme').selectOption('light');
  await expectTheme(page,'light','light');await expectTheme(peer,'light','light');await diagrams(page,'old-dark','light');await diagrams(peer,'old-dark','light');
  await page.waitForFunction(previous=>getComputedStyle(document.querySelector('[data-mermaid-preview] svg .node rect')).fill!==previous,mermaidDark);
  assert.deepEqual(await snapshot(page),before);assert.deepEqual(await snapshot(peer),peerBefore);assert.equal(await peer.locator('#canvas-stage').isVisible(),true);
  await page.emulateMedia({colorScheme:'dark'});await expectTheme(page,'light','light');
  await call(peer,'set_page',{theme:'dark',pageId:'old-light'});await expectTheme(page,'dark','dark');await expectTheme(peer,'dark','dark');
  assert.deepEqual(await snapshot(page),before);assert.deepEqual(await snapshot(peer),peerBefore);
  await call(page,'set_view',{theme:'system'});await expectTheme(page,'system','dark');await expectTheme(peer,'system','light');
  await page.emulateMedia({colorScheme:'light'});await expectTheme(page,'system','light');await page.emulateMedia({colorScheme:'dark'});await expectTheme(page,'system','dark');
  await call(page,'set_view',{theme:'dark'});await page.emulateMedia({colorScheme:'light'});await expectTheme(page,'dark','dark');
  await peer.close();await page.reload();await ready(page);await expectTheme(page,'dark','dark');await diagrams(page,'old-dark','dark');
  // Imported legacy themes never replace an established global preference.
  await page.evaluate(async book=>{const app=await import('./src/app.js');await app.getStore().import(JSON.stringify(book));},book);await expectTheme(page,'dark','dark');
  assert.deepEqual(JSON.parse((await snapshot(page)).json).pages.map(p=>p.theme),['dark','light']);
  await assert.rejects(()=>call(page,'set_view',{theme:'sepia'}));await expectTheme(page,'dark','dark');
  await page.evaluate(()=>{window.themeSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='omd.view.v1')throw new Error('quota');return window.themeSetItem.call(this,key,value);};document.getElementById('settings-dialog').showModal();});
  const failureBefore=await snapshot(page);await page.locator('#theme').selectOption('light');await expectTheme(page,'dark','dark');assert.deepEqual(await snapshot(page),failureBefore);await assert.rejects(()=>call(page,'set_view',{theme:'light'}),/Could not save/);
  await page.evaluate(()=>{Storage.prototype.setItem=window.themeSetItem;document.getElementById('settings-dialog').close();});
  const reopened=await context.newPage();await reopened.goto(url);await ready(reopened);await expectTheme(reopened,'dark','dark');
  await reopened.evaluate(()=>localStorage.setItem('omd.view.v1','{"theme":"invalid"}'));await expectTheme(page,'system','light');assert.deepEqual(await snapshot(page),failureBefore);
  await reopened.reload();await ready(reopened);await expectTheme(reopened,'system','light');
  await call(page,'set_view',{theme:'dark'});await expectTheme(reopened,'dark','dark');await reopened.evaluate(()=>localStorage.removeItem('omd.view.v1'));await expectTheme(page,'system','light');
  assert.deepEqual(errors,[]);await context.close();
  console.log(`Global theme migration, page switching/creation/import, cross-tab UI/canvas sync, OS changes, reload/reopen, history isolation and storage failures passed (${engine}, ${basePath||'/'}).`);
}finally{await browser?.close();server.kill('SIGTERM');}
