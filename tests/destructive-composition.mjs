import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';

const engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4359${basePath}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,OMD_PORT:'4359',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser;
const start=async(input,value)=>input.evaluate((el,value)=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value=value;el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));},value);
const end=input=>input.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch();const page=await browser.newPage();await page.goto(url);
  await page.evaluate(async source=>{window.app=await import(source);await app.ready;window.store=app.getStore();const {createTools}=await import(new URL('webmcp.js',source).href);window.tools=createTools(store,{flushPending:app.flushPending});window.call=(name,input)=>tools.find(t=>t.name===`omd_${name}`).execute(input);},new URL('src/app.js',url).href);
  // These exercise the WebMCP tool adapter against the actual app/IndexedDB, without requiring native browser WebMCP.
  const heading=await page.evaluate(async()=>{await store.dispatch('page_add',{title:'Destructive IME'});return store.dispatch('add_block',{type:'heading',text:'Before composition'});});
  let input=page.getByRole('textbox',{name:'heading content',exact:true});await start(input,'Tiếng Việt đã nhập');
  await page.evaluate(blockId=>{window.finished=false;window.deleting=call('remove_block',{blockId}).then(result=>{finished=true;return result;});},heading.blockId);
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>finished),false);assert.equal(await input.evaluate(el=>el.isConnected),true);
  await end(input);await page.evaluate(()=>deleting);assert.equal(await page.evaluate(()=>store.getState().blocks.length),0);
  await page.evaluate(()=>call('undo'));assert.equal(await page.evaluate(()=>store.getState().blocks[0].text),'Tiếng Việt đã nhập');await page.evaluate(()=>app.flushPending());

  // A failed final save must reject removal, retain the draft, and allow retry/undo.
  await page.evaluate(()=>{const dispatch=store.dispatch;window.restoreDispatch=()=>store.dispatch=dispatch;store.dispatch=(name,input,options)=>name==='update_block'&&input.patch?.text==='Retained composed draft'?Promise.reject(new Error('Injected destructive draft failure')):dispatch(name,input,options);});
  input=page.getByRole('textbox',{name:'heading content',exact:true});await start(input,'Retained composed draft');
  await page.evaluate(blockId=>{window.deleting=call('remove_block',{blockId}).then(()=>({removed:true}),error=>({error:error.message}));},heading.blockId);
  await end(input);assert.match((await page.evaluate(()=>deleting)).error,/Could not save/);assert.equal(await input.inputValue(),'Retained composed draft');assert.equal(await page.evaluate(()=>store.getState().blocks.length),1);
  await page.evaluate(async()=>{restoreDispatch();await app.flushPending();});await page.evaluate(()=>call('undo'));assert.equal(await page.evaluate(()=>store.getState().blocks[0].text),'Tiếng Việt đã nhập');

  // Page removal must also wait for its header's final write; undo restores the composed title.
  const pageId=await page.evaluate(()=>store.getActivePageId());input=page.locator('#page-title');await start(input,'Composed page title');
  await page.evaluate(pageId=>{window.finished=false;window.deleting=call('page_remove',{pageId}).then(result=>{finished=true;return result;});},pageId);
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>finished),false);await end(input);await page.evaluate(()=>deleting);await page.evaluate(()=>call('undo'));
  assert.equal(await page.evaluate(async id=>(await store.getPage(id)).title,pageId),'Composed page title');

  // Bridge approval predates the draft: saving composition must invalidate that approval safely.
  await page.evaluate(pageId=>store.dispatch('page_select',{pageId}),pageId);
  const context=await page.evaluate(()=>window.agentBridgeV1.getContext());input=page.getByRole('textbox',{name:'heading content',exact:true});await start(input,'Bridge composed draft');
  const request={requestId:crypto.randomUUID(),documentId:context.documentId,toolName:'omd_remove_block',arguments:{pageId,blockId:heading.blockId},expectedRevision:context.revision,idempotencyKey:crypto.randomUUID()};
  await page.evaluate(request=>{window.finished=false;window.deleting=agentBridgeV1.invoke(request).then(result=>{finished=true;return result;});},request);
  await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>finished),false);await end(input);assert.equal((await page.evaluate(()=>deleting)).error.code,'STALE_CONTEXT');assert.equal(await page.evaluate(()=>store.getState().blocks[0].text),'Bridge composed draft');
  const fresh=await page.evaluate(()=>agentBridgeV1.getContext());assert.equal((await page.evaluate(request=>agentBridgeV1.invoke(request),{...request,requestId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID(),expectedRevision:fresh.revision})).ok,true);
  await page.evaluate(()=>call('undo'));assert.equal(await page.evaluate(()=>store.getState().blocks[0].text),'Bridge composed draft');
  // Import's backup download is asynchronous; composition begun there must also settle safely.
  await page.evaluate(async source=>{const {createTools}=await import(new URL('webmcp.js',source).href);const json=await store.export();window.backupWaiting=false;const gate=new Promise(resolve=>{window.releaseBackup=resolve;});const importing=createTools(store,{flushPending:app.flushPending,confirmImport:async()=>true,download:()=>{backupWaiting=true;return gate;}}).find(t=>t.name==='omd_import_notebook');window.importing=importing.execute({json}).then(()=>({imported:true}),error=>({error:error.message}));},new URL('src/app.js',url).href);
  await page.waitForFunction(()=>backupWaiting);input=page.getByRole('textbox',{name:'heading content',exact:true});await start(input,'Composed during backup');await page.evaluate(()=>releaseBackup());await page.waitForTimeout(100);await end(input);
  assert.match((await page.evaluate(()=>importing)).error,/changed during backup/);assert.equal(await page.evaluate(()=>store.getState().blocks[0].text),'Composed during backup');
  console.log(`${engine} ${basePath||'/'}: destructive IME block/page removal, failed save/retry, undo and Bridge stale consent passed.`);
}finally{await browser?.close();server.kill();}
