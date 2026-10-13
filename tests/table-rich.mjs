import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {chromium,webkit} from 'playwright';

const root=fileURLToPath(new URL('..',import.meta.url)),engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'';
const url=`http://localhost:4333${base}/`;
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4333',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});
let browser,page,id;const errors=[];
const ready=async()=>{page.on('pageerror',error=>errors.push(error.message));await page.goto(url);await page.evaluate(async()=>{window.richApp=await import(new URL('./src/app.js',document.baseURI).href);await richApp.ready;});};
const call=(name,input={})=>page.evaluate(async({name,input})=>{await richApp.flushPending();return richApp.getStore().dispatch(name,input);},{name,input});
const flush=()=>page.evaluate(()=>richApp.flushPending());
const grid=()=>page.evaluate(async id=>{const store=richApp.getStore();await store.idle();const {findBlock}=await import(new URL('./src/model.js',document.baseURI).href);return findBlock(store.getState(),id,'table').block;},id);
const block=()=>page.locator(`[data-block-id="${id}"]`),cell=(r=1,c=1)=>block().getByRole('textbox',{name:`Table row ${r}, column ${c}`,exact:true}),bar=()=>block().getByRole('toolbar',{name:'Table text formatting'});
const select=async(box=cell())=>{await box.click();await box.press('ControlOrMeta+a');};
const source=async()=>{await flush();return (await grid()).rows[0].cells[0];};
const write=async(text,r=1,c=1)=>{const b=await grid();await call('table_cell_update',{blockId:id,rowId:b.rows[r-1].id,columnId:b.columns[c-1].id,text});};
const openLink=async(box=cell(),tap=false)=>{
  const link=box.locator('a').first(),before=await grid();await page.waitForTimeout(550);
  const [popup]=await Promise.all([page.waitForEvent('popup'),tap?link.tap():link.click()]);await popup.waitForLoadState();
  assert.equal(popup.url(),'https://example.com/table');assert.deepEqual(await popup.evaluate(()=>[window.opener,document.referrer]),[null,'']);await popup.close();assert.deepEqual(await grid(),before);
};
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);server.once('exit',code=>reject(new Error(`Server exited ${code}`)));});
  browser=await({chromium,webkit}[engine]).launch({headless:true});const context=await browser.newContext({viewport:{width:1280,height:900}});context.setDefaultTimeout(10000);
  await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Table link</title>'}));page=await context.newPage();await ready();
  await call('page_add',{title:'Rich table'});id=(await call('add_block',{type:'table',rowCount:2,columnCount:2})).blockId;
  assert.equal(await bar().getByRole('button',{name:'Bold',exact:true}).isDisabled(),true);
  // Actual selection and toolbar actions persist Markdown strings and render their marks.
  for(const [name,tag,markdown]of [['Bold','strong',/\*\*Format me\*\*/],['Italic','em',/\*Format me\*/],['Strikethrough','s',/~~Format me~~/],['Inline code','code',/`Format me`/]]){
    await write('');await cell().fill('Format me');await select();await bar().getByRole('button',{name,exact:true}).click();assert.equal(await cell().locator(tag).innerText(),'Format me');assert.match(await source(),markdown);
  }
  for(const [name,tag]of [['Bullet list','ul'],['Numbered list','ol']]){await write('list item');await cell().click();await bar().getByRole('button',{name,exact:true}).click();assert.equal(await cell().locator(`${tag} li`).innerText(),'list item');assert.match(await source(),/list item/);}
  await write('Linked words');await select();page.once('dialog',dialog=>dialog.accept('https://example.com/table'));await bar().getByRole('button',{name:'Link',exact:true}).click();
  assert.equal(await cell().locator('a').innerText(),'Linked words');assert.equal(await source(),'[Linked words](https://example.com/table)');await openLink();
  await select();page.once('dialog',dialog=>dialog.accept('javascript:alert(1)'));await bar().getByRole('button',{name:'Link',exact:true}).click();assert.equal(await cell().locator('a').getAttribute('href'),'https://example.com/table');
  await select();page.once('dialog',dialog=>dialog.accept(''));await bar().getByRole('button',{name:'Link',exact:true}).click();assert.equal(await cell().locator('a').count(),0);assert.equal(await source(),'Linked words');
  // Native keyboard formatting uses notebook history, including redo.
  await write('Keyboard');await select();await cell().press('ControlOrMeta+b');assert.equal(await source(),'**Keyboard**');await cell().press('ControlOrMeta+z');await cell().locator('strong').waitFor({state:'detached'});assert.equal(await source(),'Keyboard');await cell().press('ControlOrMeta+Shift+z');await cell().locator('strong').waitFor();assert.equal(await source(),'**Keyboard**');
  await cell().press('Alt+F10');assert.equal(await bar().getByRole('button',{name:'Bold',exact:true}).evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await cell().evaluate(el=>el===document.activeElement),true);
  // Plain Markdown and rich HTML clipboard both retain supported formatting safely.
  await write('');await cell().click();await cell().evaluate(el=>{const data=new DataTransfer();data.setData('text/plain','**pasted** and *italic*');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});assert.equal(await cell().locator('strong').innerText(),'pasted');assert.equal(await cell().locator('em').innerText(),'italic');assert.equal(await source(),'**pasted** and *italic*');
  await write('');await cell().click();await cell().evaluate(el=>{window.tableExecuted=false;const data=new DataTransfer();data.setData('text/html','<p><strong>HTML bold</strong><img src="x" onerror="window.tableExecuted=true"><script>window.tableExecuted=true</script><a href="javascript:alert(1)">unsafe</a></p>');data.setData('text/plain','HTML boldunsafe');el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));});await flush();assert.equal(await cell().locator('strong').innerText(),'HTML bold');assert.equal(await cell().locator('script,img,a[href^="javascript:"]').count(),0);assert.equal(await page.evaluate(()=>window.tableExecuted),false);
  // Reconciliation preserves editor identity, selection and rich source across neighboring changes.
  await write('caret stays');await cell().click();await cell().press('Home');await cell().press('ArrowRight');await cell().press('Shift+ArrowRight');await page.waitForFunction(()=>document.activeElement.editor.state.selection.from!==document.activeElement.editor.state.selection.to);
  const selection=await cell().evaluate(el=>{window.tableCaret=el;return [el.editor.state.selection.from,el.editor.state.selection.to];});await write('neighbor',2,2);
  assert.equal(await cell().evaluate(el=>el===window.tableCaret&&el===document.activeElement),true);assert.deepEqual(await cell().evaluate(el=>[el.editor.state.selection.from,el.editor.state.selection.to]),selection);
  await call('table_row_add',{blockId:id,index:0});assert.equal(await cell(2,1).evaluate(el=>el===window.tableCaret),true);await page.evaluate(()=>richApp.getStore().undo());assert.equal(await cell().evaluate(el=>el===window.tableCaret),true);
  // Composed text remains a draft when IndexedDB rejects its final write, then retries.
  await page.evaluate(()=>{window.richPut=IDBObjectStore.prototype.put;const db=richApp.getStore().databaseName();IDBObjectStore.prototype.put=function(...args){if(this.transaction.db.name===db)throw new DOMException('Rich IME quota','QuotaExceededError');return richPut.apply(this,args);};});
  await cell().evaluate(el=>{el.focus();el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.replaceChildren(Object.assign(document.createElement('p'),{textContent:'日本語 Việt'}));el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertCompositionText',isComposing:true}));});
  assert.equal((await grid()).rows[0].cells[0],'caret stays');assert.equal(await bar().getByRole('button',{name:'Bold',exact:true}).isDisabled(),true);
  await cell().evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'日本語 Việt'})));await page.locator('.notice.error').filter({hasText:'Rich IME quota'}).first().waitFor();assert.equal(await cell().innerText(),'日本語 Việt');assert.equal((await grid()).rows[0].cells[0],'caret stays');await assert.rejects(flush,/Rich IME quota/);
  await page.evaluate(()=>{IDBObjectStore.prototype.put=richPut;});await flush();assert.equal(await source(),'日本語 Việt');
  await write('**saved** *rich* [link](https://example.com/table)\n\n- first\n- `second`');const saved=await grid();await page.reload();await page.evaluate(async()=>{window.richApp=await import(new URL('./src/app.js',document.baseURI).href);await richApp.ready;});assert.deepEqual(await grid(),saved);assert.equal(await cell().locator('strong').innerText(),'saved');assert.equal(await cell().locator('ul li').count(),2);
  const exported=await page.evaluate(()=>richApp.getStore().export());await write('changed');await page.evaluate(json=>richApp.getStore().import(json),exported);assert.deepEqual(await grid(),saved);assert.equal(await cell().locator('strong').innerText(),'saved');
  // Actual touch interaction at 320px preserves the selected text and link navigation.
  const mobile=await browser.newContext({viewport:{width:320,height:844},hasTouch:true});mobile.setDefaultTimeout(10000);await mobile.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Table link</title>'}));page=await mobile.newPage();await ready();await page.evaluate(()=>richApp.setView({sidebarOpen:false}));await call('page_add',{title:'Touch rich table'});id=(await call('add_block',{type:'table',rowCount:1,columnCount:1})).blockId;
  await cell().fill('touch words');await cell().tap();await cell().evaluate(el=>el.editor.commands.selectAll());await bar().getByRole('button',{name:'Bold',exact:true}).tap();assert.equal(await cell().locator('strong').innerText(),'touch words');assert.equal(await source(),'**touch words**');
  await write('[Touch link](https://example.com/table)');await openLink(cell(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await mobile.close();await context.close();assert.deepEqual(errors,[]);console.log(`${engine} ${base||'/'}: table rich marks, lists, links, clipboard safety, history, toolbar keyboard/touch, stable caret, composition failure/retry, reload and JSON roundtrip passed.`);
}finally{await browser?.close();server.kill();}
