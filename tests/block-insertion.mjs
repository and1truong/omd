import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium, webkit } from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium';
assert.ok(['chromium','webkit'].includes(engine));
const basePath=process.env.OMD_BASE_PATH??'',url=`http://localhost:4320${basePath}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4320',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser,page;const errors=[];
const call=(name,input={})=>page.evaluate(async({name,input})=>{
  const store=(await import('./src/app.js')).getStore();
  return name==='undo'?store.undo():name==='redo'?store.redo():store.dispatch(name,input);
},{name,input});
const state=()=>page.evaluate(async()=>(await import('./src/app.js')).getStore().getPage());
const order=async()=>((await state()).blocks.map(block=>block.id));
const choose=async name=>{await page.locator('#picker').getByRole('button',{name:`Add ${name}`,exact:true}).click();await page.locator('#picker').waitFor({state:'hidden'});};
const focused=async id=>page.waitForFunction(id=>document.activeElement?.closest('[data-block-id]')?.getAttribute('data-block-id')===id,id);
const fixture=async()=>{
  await call('page_add',{title:'Insert blocks where you need them'});
  const blocks=[];for(const text of ['First thought','Second thought','Third thought'])blocks.push((await call('add_block',{type:'text',text})).blockId);
  await page.locator(`[data-before-block="${blocks[2]}"]`).waitFor();return blocks;
};
const ready=async()=>{
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.evaluate(async()=>{const app=await import('./src/app.js');await app.ready;if(!app.getStore())throw new Error(document.body.innerText);});
};

try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(10000);
  page=await context.newPage();await ready();
  const [first,second,third]=await fixture(),original=[first,second,third];

  // Keyboard users can insert above the first block, then undo and redo.
  await page.locator(`[data-before-block="${first}"]`).focus();await page.keyboard.press('Enter');await choose('heading');
  const heading=(await order())[0];assert.deepEqual(await order(),[heading,...original]);await focused(heading);
  await page.locator(`[data-block-id="${heading}"] textarea`).fill('A section at the top');
  await page.evaluate(async()=>(await import('./src/app.js')).getStore().idle());
  await call('undo');await call('undo');assert.deepEqual(await order(),original);
  await call('redo');assert.deepEqual(await order(),[heading,...original]);await call('undo');

  // The visible gap after the first block inserts between its neighbors.
  await page.locator(`[data-before-block="${second}"]`).click();await choose('checklist');
  const checklist=(await order())[1];assert.deepEqual(await order(),[first,checklist,second,third]);await focused(checklist);
  await mkdir(`${root}/test-results`,{recursive:true});
  await page.screenshot({path:`${root}/test-results/block-insertion-${engine}-desktop.png`});
  await call('undo');assert.deepEqual(await order(),original);

  // Cancellation restores focus and does not leave a stale insertion index for append.
  const gap=page.locator(`[data-before-block="${second}"]`);
  await gap.click();await page.keyboard.press('Escape');assert.deepEqual(await order(),original);
  assert.equal(await gap.evaluate(el=>el===document.activeElement),true);
  await page.locator('.block-list[data-container="page"] > .add-block-button').click();await choose('text');
  assert.deepEqual((await order()).slice(0,3),original);assert.equal((await order()).length,4);await call('undo');

  // Both menu directions insert next to the chosen block, with focus even for a divider.
  for(const side of ['before','after']){
    await page.locator(`[data-block-id="${first}"]`).getByRole('button',{name:'Block actions',exact:true}).click();
    await page.locator('#block-actions-dialog').getByRole('button',{name:`Insert block ${side}`,exact:true}).click();
    await choose('divider');const ids=await order(),inserted=ids[side==='before'?0:1];
    assert.deepEqual(ids,side==='before'?[inserted,...original]:[first,inserted,second,third]);await focused(inserted);await call('undo');
  }

  // Recompute the anchor's current position if the list changes while the picker is open.
  await gap.click();await call('move_block',{blockId:second,index:2});await choose('text');
  const anchored=(await order())[2];assert.deepEqual(await order(),[first,third,anchored,second]);await call('undo');await call('undo');
  await gap.click();await call('remove_block',{blockId:second});await page.locator('#picker').getByRole('button',{name:'Add text',exact:true}).click();
  await page.getByText('The block moved or was removed. Close the picker and choose a new position.',{exact:true}).waitFor();
  assert.deepEqual(await order(),[first,third]);assert.equal(await page.locator('#picker').getByRole('button',{name:'Add text',exact:true}).isEnabled(),true);
  await page.keyboard.press('Escape');await call('undo');

  // Every visible nested container uses its own insertion order and tab restrictions.
  for(const type of ['tabs','toggle','accordion']){
    const parent=(await call('add_block',{type})).block;
    const containerId=type==='tabs'?parent.tabs[0].id:type==='toggle'?parent.id:parent.items[0].id;
    const one=(await call('add_block',{type:'text',text:'Nested first',containerId})).blockId;
    const two=(await call('add_block',{type:'text',text:'Nested second',containerId})).blockId;
    await page.locator(`[data-before-block="${two}"]`).click();
    if(type==='tabs'){
      assert.equal(await page.locator('#picker').getByRole('button',{name:'Add horizontal tabs',exact:true}).count(),0);
      assert.equal(await page.locator('#picker').getByRole('button',{name:'Add vertical tabs',exact:true}).count(),1);
    }
    await choose('text');
    const current=(await state()).blocks.find(block=>block.id===parent.id);
    const children=type==='tabs'?current.tabs[0].blocks:type==='toggle'?current.blocks:current.items[0].blocks;
    assert.equal(children.length,3);assert.equal(children[0].id,one);assert.equal(children[2].id,two);await focused(children[1].id);
    await call('undo');await call('remove_block',{blockId:parent.id});
  }

  // Page navigation closes the picker rather than inserting into the new page.
  await gap.click();await call('page_add',{title:'Another page'});
  await page.locator('#picker').waitFor({state:'hidden'});assert.deepEqual(await order(),[]);
  await context.close();

  // Touch users see a real, 44px target without needing hover or a drag handle.
  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});mobile.setDefaultTimeout(10000);
  page=await mobile.newPage();await ready();const mobileIds=await fixture();
  const mobileGap=page.locator(`[data-before-block="${mobileIds[1]}"]`);
  assert.ok((await mobileGap.boundingBox()).height>=44);
  assert.equal(await mobileGap.evaluate(el=>getComputedStyle(el).visibility),'visible');
  await mobileGap.tap();await choose('text');const added=(await order())[1];
  assert.deepEqual(await order(),[mobileIds[0],added,mobileIds[1],mobileIds[2]]);await focused(added);
  await page.locator(`[data-block-id="${added}"] textarea`).fill('Right after the first thought');
  await page.screenshot({path:`${root}/test-results/block-insertion-${engine}-mobile.png`});
  await page.locator(`[data-block-id="${mobileIds[0]}"]`).getByRole('button',{name:'Block actions',exact:true}).tap();
  await page.locator('#block-actions-dialog').getByRole('button',{name:'Insert block after',exact:true}).tap();await choose('divider');
  const divider=(await order())[1];await focused(divider);
  assert.equal(await page.evaluate(()=>document.activeElement.getAttribute('aria-label')),'Block actions');
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Insertion controls must fit mobile.');
  await page.reload();await page.evaluate(async()=>await (await import('./src/app.js')).ready);
  assert.deepEqual(await order(),[mobileIds[0],divider,added,mobileIds[1],mobileIds[2]]);
  await mobile.close();assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: inline/menu insertion, keyboard/touch, nested order, focus, cancellation, undo/redo and persistence passed.`);
} finally {await browser?.close();server.kill();}
