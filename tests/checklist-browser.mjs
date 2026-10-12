import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium',basePath=process.env.OMD_BASE_PATH??'';
assert.ok(['chromium','webkit'].includes(engine));
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4321',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser,page,blockId;const errors=[];
const call=(name,input={})=>page.evaluate(async({name,input})=>{
  const store=(await import('./src/app.js')).getStore();return name==='undo'?store.undo():name==='redo'?store.redo():store.dispatch(name,input);
},{name,input});
const items=()=>page.evaluate(async blockId=>{
  const store=(await import('./src/app.js')).getStore();await store.idle();
  const {findBlock}=await import('./src/model.js');return findBlock(store.getState(),blockId,'checklist').block.items;
},blockId);
const input=id=>page.locator(`[id="${id}"]`);
const row=id=>page.locator(`[data-item-id="${id}"] > .check-row`);
const focused=id=>page.waitForFunction(id=>document.activeElement?.id===id,id);
const menu=async id=>{await row(id).getByRole('button',{name:'Checklist item actions',exact:true}).click();return page.locator('#block-actions-dialog');};
const children=id=>{const visit=items=>{for(const item of items){if(item.id===id)return item.children??[];const found=visit(item.children??[]);if(found)return found;}};return items().then(visit);};
const addChild=async id=>{
  const count=(await children(id)).length;
  await (await menu(id)).getByRole('button',{name:'Add child checklist item',exact:true}).click();
  await page.waitForFunction(({id,count})=>document.querySelector(`[data-item-id="${id}"] > .checklist-items`)?.children.length===count+1,{id,count});
  const child=(await children(id)).at(-1).id;await focused(child);return child;
};
async function ready() {
  page.on('pageerror',error=>errors.push(error.message));await page.goto(`http://localhost:4321${basePath}/`);
  await page.evaluate(async()=>await (await import('./src/app.js')).ready);
}
async function fixture() {
  await call('page_add',{title:'Nested checklist'});
  const toggle=(await call('add_block',{type:'toggle',title:'Project'})).block;
  blockId=(await call('add_block',{type:'checklist',containerId:toggle.id,title:'Steps'})).blockId;
  await page.locator(`[data-block-id="${blockId}"]`).getByRole('button',{name:'Add checklist item',exact:true}).click();
  await page.locator(`[data-block-id="${blockId}"] .check-row`).waitFor();
  const first=(await items())[0].id;await focused(first);await input(first).fill('Plan');await input(first).press('Enter');
  await page.waitForFunction(blockId=>document.querySelector(`[data-block-id="${blockId}"] > .checklist-items`)?.children.length===2,blockId);
  const second=(await items())[1].id;await focused(second);await input(second).fill('Build');return [first,second];
}

try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited: ${code}`)));});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});
  const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(10000);
  page=await context.newPage();await ready();const [first,second]=await fixture();

  await input(second).press('Tab');await focused(second);assert.equal((await children(first))[0].id,second);
  await input(second).press('Shift+Tab');await focused(second);assert.deepEqual((await items()).map(i=>i.id),[first,second]);
  const child=await addChild(second);await input(child).fill('Child');
  const grandchild=await addChild(child);await input(grandchild).fill('Grandchild');
  const leaf=await addChild(grandchild);await input(leaf).fill('Leaf');
  assert.equal(await input(leaf).locator('..').locator('..').getAttribute('data-level'),'4');
  let actions=await menu(leaf);
  assert.equal(await actions.getByRole('button',{name:'Add child checklist item',exact:true}).isDisabled(),true);
  assert.equal(await actions.getByRole('button',{name:'Indent checklist item',exact:true}).isDisabled(),true);
  await page.keyboard.press('Escape');
  actions=await menu(second);assert.equal(await actions.getByRole('button',{name:'Indent checklist item',exact:true}).isDisabled(),true);await page.keyboard.press('Escape');
  await input(second).press('Tab');assert.equal((await items()).length,2,'A four-level branch cannot be indented.');

  // Enter creates a sibling at level 4, and sibling arrows preserve the parent.
  await input(leaf).press('Enter');const sibling=(await children(grandchild))[1].id;await focused(sibling);await input(sibling).fill('Sibling');
  await row(sibling).getByRole('button',{name:'Move checklist item up',exact:true}).click();await focused(sibling);
  assert.deepEqual((await children(grandchild)).map(i=>i.id),[sibling,leaf]);
  await row(sibling).getByRole('button',{name:'Move checklist item down',exact:true}).click();await focused(sibling);
  assert.deepEqual((await children(grandchild)).map(i=>i.id),[leaf,sibling]);
  await row(leaf).getByRole('checkbox').check();
  await page.waitForFunction(blockId=>document.querySelector(`[data-block-id="${blockId}"] .checklist-progress`)?.textContent==='1 / 6',blockId);
  assert.equal(await page.locator(`[data-block-id="${blockId}"] .checklist-progress`).textContent(),'1 / 6');
  assert.equal(await row(grandchild).getByRole('checkbox').isChecked(),false);

  // Outdent and indent move the full branch while preserving focus.
  await input(grandchild).press('Shift+Tab');await focused(grandchild);
  assert.deepEqual((await children(second)).map(i=>i.id),[child,grandchild]);
  await input(grandchild).press('Tab');await focused(grandchild);assert.equal((await children(child))[0].id,grandchild);

  // Composition Enter must not add an item before committing text.
  const before=await items();
  await input(leaf).evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true}));});
  assert.deepEqual(await items(),before);
  await mkdir(`${root}/test-results`,{recursive:true});await page.screenshot({path:`${root}/test-results/checklist-${engine}-desktop.png`});
  await row(second).getByRole('button',{name:'Delete checklist item',exact:true}).click();await input(second).waitFor({state:'detached'});assert.equal((await items()).length,1);
  await call('undo');assert.deepEqual(await items(),before);await call('redo');assert.equal((await items()).length,1);await call('undo');
  await page.reload();await page.evaluate(async()=>await (await import('./src/app.js')).ready);assert.deepEqual(await items(),before);
  await context.close();

  // Touch controls and four levels fit even the smallest supported viewport.
  const mobile=await browser.newContext({viewport:{width:320,height:844},isMobile:true,hasTouch:true});mobile.setDefaultTimeout(10000);
  page=await mobile.newPage();await ready();const [,parent]=await fixture();
  const nested=await addChild(parent),deep=await addChild(nested),last=await addChild(deep);await input(last).fill('Deep mobile task');
  actions=await menu(last);assert.equal(await actions.getByRole('button',{name:'Add child checklist item',exact:true}).isDisabled(),true);
  await actions.getByRole('button',{name:'Outdent checklist item',exact:true}).tap();await focused(last);assert.equal((await children(nested))[1].id,last);
  actions=await menu(last);await actions.getByRole('button',{name:'Indent checklist item',exact:true}).tap();await focused(last);assert.equal((await children(deep))[0].id,last);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Nested checklist controls must fit mobile.');
  assert.ok((await input(last).boundingBox()).width>0,'Deep item text must remain editable.');
  await page.screenshot({path:`${root}/test-results/checklist-${engine}-mobile.png`});
  await mobile.close();assert.deepEqual(errors,[]);
  console.log(`${engine} ${basePath||'/'}: checklist nesting, depth limits, keyboard/touch, composition, focus, progress, undo/redo and persistence passed.`);
} finally {await browser?.close();server.kill();}
