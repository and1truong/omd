import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

export async function verifyPageRoutes({browser,appURL,call,root}) {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),a=await context.newPage(),b=await context.newPage();
  const ready=target=>target.waitForFunction(()=>document.getElementById('agent-status')?.textContent.includes('55 tools'));
  const active=async target=>(await call('get_notebook',{},target)).id;
  const selected=async(target,pageId)=>{
    await target.evaluate(async()=>{const app=await import(new URL('./src/app.js',document.baseURI).href);await app.ready;window.omdRouteStore=app.getStore();});
    await target.waitForFunction(pageId=>window.omdRouteStore.getActivePageId()===pageId,pageId);
  };
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
    await selected(b,first);
    assert.equal(await active(b),first);
    assert.equal((await call('get_page',{pageId:second},b)).blocks.find(block=>block.id===text.id).text,'Saved before navigating back');
    await b.goForward();await b.waitForURL(path(second));await selected(b,second);assert.equal(await active(b),second);
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
    await verifySurrogatePageRoutes({browser,appURL,call,root});
    console.log(`${new URL(appURL).pathname}: two shared-IDB tabs, native WebMCP, independent paths, sync, refresh/new-tab/history, pending edits, nested/invalid/deleted/imported pages, offline deep links and emitted static 404 passed.`);
  } finally {await context.close();}
}

export async function verifySurrogatePageRoutes({browser,appURL,call,root}) {
  const context=await browser.newContext({viewport:{width:1280,height:900}}),a=await context.newPage(),b=await context.newPage(),errors=[];
  for(const target of [a,b])target.on('pageerror',error=>errors.push(error.message));
  const ready=async target=>{
    await target.evaluate(async()=>{const app=await import(new URL('./src/app.js',document.baseURI).href);await app.ready;});
    await target.waitForFunction(()=>!document.modelContext?.getTools||document.getElementById('agent-status')?.textContent.includes('55 tools'));
  };
  const ids=['lone-\uD800','lone-\uDC00','mix-\uD800🚀/\0%~\uDC00','slash/\0%~','~u006c006f006e0065002dd800','paired-🚀'];
  const path=id=>{
    let segment;
    try{segment=encodeURIComponent(id.startsWith('~')?'~'+id:id);}
    catch{segment='~u'+id.split('').map(unit=>unit.charCodeAt(0).toString(16).padStart(4,'0')).join('');}
    return new URL(`page/${segment}`,appURL).href;
  };
  const selected=async(target,id)=>{
    await target.evaluate(async()=>{const app=await import(new URL('./src/app.js',document.baseURI).href);await app.ready;window.omdSurrogateStore=app.getStore();});
    await target.waitForFunction(id=>window.omdSurrogateStore.getActivePageId()===id,id);
    assert.equal((await call('get_notebook',{},target)).id,id);
    assert.equal(target.url(),path(id));
    assert.equal(await target.locator('#page-title').inputValue(),`UTF-16 route ${ids.indexOf(id)}`);
  };
  try {
    await a.goto(appURL);await ready(a);
    const book=JSON.parse((await call('export_notebook',{},a)).json),template=book.pages[0];
    book.pages=ids.map((id,index)=>({...template,id,title:`UTF-16 route ${index}`,blocks:[]}));
    book.activePageId=ids[0];book.parents=Object.fromEntries(ids.map((id,index)=>[id,index?ids[0]:'']));
    await a.evaluate(async json=>{const app=await import(new URL('./src/app.js',document.baseURI).href);await app.getStore().import(json);},JSON.stringify(book));
    await selected(a,ids[0]);
    const importing=call('import_notebook',{json:JSON.stringify(book)},a);
    await a.getByRole('button',{name:'Back up & import',exact:true}).click();await importing;
    await selected(a,ids[0]);
    await a.reload();await ready(a);await selected(a,ids[0]);
    for(let index=1;index<ids.length;index++){
      const id=ids[index],previous=ids[index-1];
      await call('page_select',{pageId:id},a);await selected(a,id);
      await a.reload();await ready(a);await selected(a,id);
      await b.goto(path(id));await ready(b);await selected(b,id);
      await a.goBack();await selected(a,previous);
      await a.goForward();await selected(a,id);
    }
    const link=b.getByRole('link',{name:'Switch to UTF-16 route 0',exact:true});
    assert.equal(await link.getAttribute('href'),new URL(path(ids[0])).pathname);
    await b.bringToFront();await link.focus();await b.waitForFunction(()=>document.hasFocus());
    let third;await b.keyboard.down('ControlOrMeta');
    try{[third]=await Promise.all([context.waitForEvent('page'),link.click({modifiers:['ControlOrMeta'],delay:50})]);}
    finally{await b.keyboard.up('ControlOrMeta');}
    try{await ready(third);await selected(third,ids[0]);await selected(b,ids.at(-1));}finally{await third.close();}
    await a.goto(appURL);await ready(a);await selected(a,ids[0]);
    for(const activePageId of ids.slice(0,3)){
      const savedContext=await browser.newContext({serviceWorkers:'block'}),savedPage=await savedContext.newPage();
      savedPage.on('pageerror',error=>errors.push(error.message));
      try{
        await savedPage.route(appURL,route=>route.fulfill({contentType:'text/html',body:`<html><head><base href="${appURL}"></head><body>Storage seed only</body></html>`}));
        await savedPage.goto(appURL);
        const before=await savedPage.evaluate(async book=>{
          if(document.getElementById('agent-status'))throw new Error('Storage must be seeded before app startup.');
          const {openRepository}=await import(new URL('./src/repository.js',document.baseURI).href);
          const repository=await openRepository(localStorage,{initial:()=>book});
          try{return await repository.export();}finally{repository.close();}
        },{...book,activePageId});
        await savedPage.unroute(appURL);await savedPage.reload();await ready(savedPage);await selected(savedPage,activePageId);
        assert.deepEqual(await savedPage.evaluate(()=>window.omdSurrogateStore.getNotebook()),before);
        await savedPage.reload();await ready(savedPage);await selected(savedPage,activePageId);
      }finally{await savedContext.close();}
    }
    const saved=await a.evaluate(async()=>{
      const store=window.omdSurrogateStore,book=JSON.parse(await store.export());
      const request=req=>new Promise((resolve,reject)=>{req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
      const db=await request(indexedDB.open(store.databaseName()));
      try{
        const tx=db.transaction(['meta','records']),[meta,records]=await Promise.all([request(tx.objectStore('meta').get('book')),request(tx.objectStore('records').getAll())]);
        return {ids:book.pages.map(page=>page.id),parents:book.parents,active:store.getActivePageId(),meta,recordIds:records.filter(row=>row.kind==='page').map(row=>row.pageId)};
      }finally{db.close();}
    });
    assert.deepEqual(saved.ids,ids);assert.deepEqual(saved.parents,book.parents);assert.equal(saved.active,ids[0]);
    assert.deepEqual(saved.meta.pages.map(page=>page.id),ids);assert.deepEqual(saved.meta.parents,book.parents);assert.equal(saved.meta.activePageId,ids[0]);
    assert.deepEqual(saved.recordIds.sort(),[...ids].sort());assert.deepEqual(errors,[]);
    await a.screenshot({path:`${root}/test-results/routes-utf16${new URL(appURL).pathname==='/'?'-root':'-omd'}.png`});
    console.log(`${new URL(appURL).pathname}: UTF-16 import, persisted exact IDs/parents, pre-existing IDB startup, reload/direct/native new-tab routes and back/forward passed.`);
  }finally{await context.close();}
}
