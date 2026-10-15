import {waitForServer} from './server-ready.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {chromium,webkit} from 'playwright';

const engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4361${basePath}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:new URL('..',import.meta.url).pathname,env:{...process.env,OMD_PORT:'4361',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser;const errors=[];
async function fixture(){
  const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);
  await page.evaluate(async source=>{
    window.app=await import(source);await app.ready;window.store=app.getStore();
    const book=await store.getNotebook(),template=book.pages[0];
    const blocks=label=>[
      {id:'shared-text',type:'text',text:`${label} saved text`},
      {id:'shared-list',type:'checklist',title:`${label} list`,items:[{id:'shared-item',text:`${label} item`,done:false}]}
    ];
    book.pages=[{...template,id:'source-page',title:'Source page',blocks:blocks('Source')},{...template,id:'target-page',title:'Target page',blocks:blocks('Target')}];
    book.activePageId='source-page';book.parents={'source-page':'','target-page':''};
    await store.import(JSON.stringify(book));
    const dispatch=store.dispatch,gate=new Promise(resolve=>window.releaseFinalSave=resolve);
    window.finalSaveWaiting=false;
    window.restoreDispatch=()=>store.dispatch=dispatch;
    store.dispatch=async(name,input,options)=>{
      if(name==='update_block'&&input.pageId==='source-page'&&input.patch?.text==='Composed source text'){
        window.finalSaveWaiting=true;await gate;
      }
      return dispatch(name,input,options);
    };
  },new URL('src/app.js',url).href);
  await page.getByRole('textbox',{name:'text content',exact:true}).evaluate(el=>{
    window.sourceEditor=el;el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));
    el.replaceChildren(Object.assign(document.createElement('p'),{textContent:'Composed source text'}));
    el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));
  });
  await page.evaluate(()=>store.dispatch('page_select',{pageId:'target-page'}));
  assert.equal(await page.evaluate(()=>store.getActivePageId()),'target-page');
  assert.equal(await page.locator('#page-title').inputValue(),'Source page');
  return {context,page};
}
const pages=page=>page.evaluate(async()=>({source:await store.getPage('source-page'),target:await store.getPage('target-page')}));
const finishComposition=page=>page.evaluate(()=>sourceEditor.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true})));
try{
  await waitForServer(server);browser=await ({chromium,webkit}[engine]).launch();
  {
    const {context,page}=await fixture();
    await finishComposition(page);await page.waitForFunction(()=>finalSaveWaiting);
    // The source DOM remains connected until its final edit is acknowledged.
    // Its controls must keep their page ownership even though the store selected the target.
    await page.getByRole('button',{name:'Add a block here',exact:true}).click();
    assert.equal(await page.locator('#picker').evaluate(dialog=>dialog.open),false,'A stale source add control must not open a picker for the target page.');
    await page.getByRole('checkbox',{name:'Complete Source item',exact:true}).check();
    await page.locator('#page-title').fill('Renamed source page');
    await page.evaluate(()=>store.idle());
    const beforeRelease=await pages(page);
    assert.equal(beforeRelease.source.blocks[1].items[0].done,true,'The visible source checkbox must update the source page.');
    assert.equal(beforeRelease.target.blocks[1].items[0].done,false,'A matching target item must remain unchanged.');
    assert.equal(beforeRelease.source.title,'Renamed source page','The displayed header must retain its source page.');
    assert.equal(beforeRelease.target.title,'Target page');
    assert.equal(beforeRelease.source.blocks[0].text,'Source saved text','The composition save must still be held.');
    await page.evaluate(async()=>{releaseFinalSave();await app.flushPending({waitForComposition:true});restoreDispatch();});
    assert.equal((await pages(page)).source.blocks[0].text,'Composed source text');
    await page.waitForFunction(()=>document.getElementById('page-title').value==='Target page');
    await context.close();
  }
  {
    const {context,page}=await fixture();
    await page.locator('[data-block-id="shared-text"]').getByRole('button',{name:'Block actions',exact:true}).click();
    await page.locator('#block-actions-dialog').getByRole('button',{name:'Delete block',exact:true}).click();
    await page.locator('#confirm-ok').click();
    let snapshot=await pages(page);
    assert.ok(snapshot.source.blocks.some(block=>block.id==='shared-text'));
    assert.ok(snapshot.target.blocks.some(block=>block.id==='shared-text'));
    await finishComposition(page);await page.waitForFunction(()=>finalSaveWaiting);
    snapshot=await pages(page);
    assert.ok(snapshot.source.blocks.some(block=>block.id==='shared-text'),'Deletion must wait for the final composition save.');
    assert.ok(snapshot.target.blocks.some(block=>block.id==='shared-text'));
    await page.evaluate(()=>releaseFinalSave());
    await page.waitForFunction(async()=>!(await store.getPage('source-page')).blocks.some(block=>block.id==='shared-text'));
    snapshot=await pages(page);
    assert.equal(snapshot.source.blocks.some(block=>block.id==='shared-text'),false,'The delete action must keep the page captured before its asynchronous flush.');
    assert.equal(snapshot.target.blocks.find(block=>block.id==='shared-text')?.text,'Target saved text','The matching target block must survive.');
    await page.evaluate(()=>restoreDispatch());await context.close();
  }
  assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: deferred composition keeps checkbox/header edits and destructive controls on their displayed page despite duplicate IDs.`);
}finally{await browser?.close();server.kill();}
