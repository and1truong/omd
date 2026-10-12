import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function verifyPageRoutes({browser,appURL,call,root}) {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),a=await context.newPage(),b=await context.newPage();
  const ready=target=>target.waitForFunction(()=>document.getElementById('agent-status')?.textContent.includes('55 tools'));
  const active=async target=>(await call('get_notebook',{},target)).id;
  const path=id=>new URL(`page/${encodeURIComponent(id)}`,appURL).href;
  const synchronized=async(target,revision)=>{
    await target.evaluate(async()=>{window.omdRouteStore=(await import(new URL('./src/app.js',document.baseURI).href)).getStore();});
    await target.waitForFunction(revision=>window.omdRouteStore.getRevision()>=revision,revision);
  };
  try {
    await a.goto(appURL);await ready(a);const first=await active(a);
    for(const block of (await call('get_notebook',{},a)).blocks)await call('remove_block',{blockId:block.id},a);
    await call('set_page',{title:'Compare — left page'},a);
    const second=(await call('page_add',{title:'Compare — right page'},a)).pageId;
    await b.goto(path(first));await ready(b);
    assert.equal(await active(a),second);assert.equal(await active(b),first);
    assert.equal(a.url(),path(second));assert.equal(b.url(),path(first));
    const revision=(await call('get_notebook',{},a)).revision;
    const history=await a.evaluate(async()=>{const store=(await import(new URL('./src/app.js',document.baseURI).href)).getStore();return store.residency().undoEntries;});
    await call('page_select',{pageId:first},a);
    await call('page_select',{pageId:second},a);
    assert.equal((await call('get_notebook',{},a)).revision,revision);
    assert.equal(await a.evaluate(async()=>(await import(new URL('./src/app.js',document.baseURI).href)).getStore().residency().undoEntries),history);
    assert.equal(await active(b),first);assert.equal(b.url(),path(first));
    const edit=await call('add_block',{type:'text',text:'Shared content; independent navigation',pageId:first},a);
    await synchronized(b,edit.revision);
    assert.equal(await b.getByRole('textbox',{name:'text content',exact:true}).innerText(),'Shared content; independent navigation');
    assert.equal(await active(a),second);assert.equal(a.url(),path(second));
    const rename=await call('set_page',{title:'Compare — right page (synced)'},a);await synchronized(b,rename.revision);
    assert.equal((await call('get_page',{pageId:second},b)).title,'Compare — right page (synced)');
    await a.reload();await b.reload();await ready(a);await ready(b);
    assert.equal(await active(a),second);assert.equal(await active(b),first);
    const link=b.getByRole('link',{name:'Switch to Compare — right page (synced)',exact:true});
    assert.equal(await link.getAttribute('href'),new URL(path(second)).pathname);
    await b.bringToFront();await link.focus();await b.waitForFunction(()=>document.hasFocus());
    await link.evaluate(node=>{
      window.omdRouteClick=null;
      window.addEventListener('click',event=>{window.omdRouteClick={ctrl:event.ctrlKey,meta:event.metaKey,button:event.button,trusted:event.isTrusted,prevented:event.defaultPrevented,href:event.target.closest('a')?.getAttribute('href'),focused:document.hasFocus(),active:document.activeElement===node};},{once:true});
    });
    await b.keyboard.down('ControlOrMeta');let third,clickCompleted=false;
    try {
      [third]=await Promise.all([context.waitForEvent('page'),link.click({modifiers:['ControlOrMeta'],delay:50}).then(()=>{clickCompleted=true;})]);
    } catch(error) {
      const snapshot=await b.evaluate(()=>({url:location.href,click:window.omdRouteClick})).catch(snapshotError=>({error:String(snapshotError)}));
      throw new Error(`Native link diagnostics: ${JSON.stringify({snapshot,clickCompleted,pages:context.pages().map(page=>page.url())})}`,{cause:error});
    } finally {await b.keyboard.up('ControlOrMeta');}
    assert.deepEqual(await b.evaluate(()=>window.omdRouteClick),{ctrl:process.platform!=='darwin',meta:process.platform==='darwin',button:0,trusted:true,prevented:false,href:new URL(path(second)).pathname,focused:true,active:true});
    await ready(third);
    assert.equal(await active(third),second);assert.equal(third.url(),path(second));assert.equal(await active(b),first);await third.close();
    await link.click();await b.waitForURL(path(second));
    const text=(await call('add_block',{type:'text',text:'Before browser history'},b)).block;
    await b.getByRole('textbox',{name:'text content',exact:true}).fill('Saved before navigating back');
    await b.goBack();await b.waitForURL(path(first));await ready(b);
    assert.equal(await active(b),first);
    assert.equal((await call('get_page',{pageId:second},b)).blocks.find(block=>block.id===text.id).text,'Saved before navigating back');
    await b.goForward();await b.waitForURL(path(second));assert.equal(await active(b),second);
    await synchronized(a,(await call('get_notebook',{},b)).revision);
    await call('page_select',{pageId:first},a);
    await a.screenshot({path:`${root}/test-results/routes-left.png`});await b.screenshot({path:`${root}/test-results/routes-right.png`});
    await a.evaluate(()=>navigator.serviceWorker.ready);await b.evaluate(()=>navigator.serviceWorker.ready);
    await a.waitForFunction(()=>!!navigator.serviceWorker.controller);await b.waitForFunction(()=>!!navigator.serviceWorker.controller);
    await context.setOffline(true);await a.reload();await b.reload();await ready(a);await ready(b);
    assert.equal(await active(a),first);assert.equal(await active(b),second);
    const offline=await context.newPage();await offline.goto(path(first));await ready(offline);assert.equal(await active(offline),first);await offline.close();await context.setOffline(false);
    const child=(await call('page_add',{title:'Stable nested page',parentId:second},a)).pageId;
    await synchronized(b,(await call('get_notebook',{},a)).revision);
    assert.equal(await active(b),second);assert.equal(b.url(),path(second));
    await b.goto(path(child));await ready(b);assert.equal(await active(b),child);
    assert.equal((await call('list_pages',{},b)).find(page=>page.pageId===child).parentId,second);
    const count=(await call('list_pages',{},b)).length,beforeInvalid=(await call('get_notebook',{},b)).revision;
    for(const invalid of ['page/missing-page','page/','page']) {
      await b.goto(new URL(invalid,appURL).href);await ready(b);
      const selected=await active(b);assert.ok((await call('list_pages',{},b)).some(page=>page.pageId===selected));
      assert.equal(b.url(),path(selected));assert.match(await b.locator('#notices').innerText(),/missing|deleted/i);
    }
    assert.equal((await call('list_pages',{},b)).length,count);assert.equal((await call('get_notebook',{},b)).revision,beforeInvalid);
    await b.goto(path(child));await ready(b);
    await call('page_remove',{pageId:child},a);
    await b.waitForFunction(id=>!location.pathname.endsWith(`/page/${id}`),child);
    assert.notEqual(await active(b),child);assert.match(await b.locator('#notices').innerText(),/missing|deleted/i);
    const imported=JSON.parse((await call('export_notebook',{},a)).json);
    imported.id='replacement-route-notebook';imported.activePageId=second;imported.pages=imported.pages.filter(page=>page.id===second);imported.parents={[second]:''};
    const importing=call('import_notebook',{json:JSON.stringify(imported)},a);
    await a.getByRole('button',{name:'Back up & import',exact:true}).click();await importing;
    await b.waitForURL(path(second));assert.equal(await active(b),second);assert.equal((await call('list_pages',{},b)).length,1);
    for(const asset of ['src/missing.js','src/missing.css','page/missing.js']) {
      const response=await context.request.get(new URL(asset,appURL).href,{headers:{'sec-fetch-dest':asset.endsWith('.css')?'style':'script'}});
      assert.equal(response.status(),404);assert.doesNotMatch(response.headers()['content-type']??'',/text\/html/);
    }
    // Serve the emitted GitHub Pages fallback with a genuine 404 response and retain the requested path.
    const fallbackContext=await browser.newContext({serviceWorkers:'block'}),fallback=await fallbackContext.newPage();
    try {
      await fallback.addInitScript(book=>localStorage.setItem('omd.notebook.v1',JSON.stringify(book)),imported);
      const html=await readFile(`${root}/dist/404.html`,'utf8');
      await fallback.route(path(second),route=>route.fulfill({status:404,contentType:'text/html',body:html}));
      await fallback.goto(path(second));await ready(fallback);assert.equal(await active(fallback),second);assert.equal(fallback.url(),path(second));
      assert.equal(await fallback.evaluate(()=>document.baseURI),appURL);
      const drawing=(await call('add_block',{type:'excalidraw'},fallback)).block;
      await fallback.locator(`[data-block-id="${drawing.id}"] .excalidraw canvas`).first().waitFor();
    } finally {await fallbackContext.close();}
    console.log(`${new URL(appURL).pathname}: two shared-IDB tabs, native WebMCP, independent paths, sync, refresh/new-tab/history, pending edits, nested/invalid/deleted/imported pages, offline deep links and emitted static 404 passed.`);
  } finally {await context.close();}
}
