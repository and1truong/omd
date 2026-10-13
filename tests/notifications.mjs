import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const root=new URL('..',import.meta.url).pathname,engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'';
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_PORT:'4334',OMD_STATIC_DIR:'dist'},stdio:['ignore','pipe','pipe']});let browser;
try{
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});browser=await({chromium,webkit}[engine]).launch();
  const context=await browser.newContext({viewport:{width:1280,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://localhost:4334${base}/`);await page.evaluate(async()=>{window.toastApp=await import(new URL('./src/app.js',document.baseURI).href);await toastApp.ready;});
  await mkdir(`${root}/test-results`,{recursive:true});
  const cards=page.locator('.notice');
  for(const mobile of [false,true])for(const theme of ['light','dark']){
    await page.setViewportSize({width:mobile?320:1280,height:mobile?700:900});await page.evaluate(async theme=>{await toastApp.setView({theme});document.getElementById('notices').replaceChildren();toastApp.notify('Notebook exported. Keep a copy somewhere safe.','',true);toastApp.notify('Your changes could not be saved. Free some space and try again.','error',true);toastApp.notify('Reminder: Review your notes for tomorrow.','reminder',true);},theme);
    assert.equal(await cards.count(),3);assert.equal(await cards.locator('.notice-icon svg').count(),3);assert.equal(await cards.getByRole('button',{name:'Dismiss message',exact:true}).count(),3);
    for(const card of await cards.all()){const bounds=await card.boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=(mobile?320:1280));assert.ok(bounds.y>=0&&bounds.y+bounds.height<=(mobile?700:900));}
    await page.screenshot({path:`${root}/test-results/toasts-${engine}-${base?'project':'root'}-${mobile?'mobile':'desktop'}-${theme}.png`,animations:'disabled'});
  }
  // Long messages wrap within the smallest viewport; notification text remains plain text.
  await page.evaluate(()=>{document.getElementById('notices').replaceChildren();toastApp.notify('<img src=x onerror="alert(1)"> '+('long-message-'.repeat(30)),'error',true);});
  assert.equal(await cards.locator('img').count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const close=cards.getByRole('button',{name:'Dismiss message',exact:true});await close.focus();await page.keyboard.press('Enter');assert.equal(await cards.count(),0);
  await page.emulateMedia({reducedMotion:'reduce'});await page.clock.install();
  await page.evaluate(()=>toastApp.notify('Temporary notification.'));assert.equal(await cards.evaluate(el=>getComputedStyle(el).animationName),'none');await page.clock.runFor(5001);assert.equal(await cards.count(),0);
  await page.evaluate(()=>{toastApp.notify('Persistent save failure.','error',true);toastApp.notify('Temporary error.','error');});await page.clock.runFor(12001);assert.equal(await cards.count(),1);assert.equal(await cards.locator('.notice-message').innerText(),'Persistent save failure.');
  await cards.getByRole('button',{name:'Dismiss message',exact:true}).click();assert.equal(await cards.count(),0);assert.deepEqual(errors,[]);
  await context.close();console.log(`${engine} ${base||'/'}: light/dark desktop/mobile notifications, icons, wrapping, safe text, keyboard dismissal, reduced motion and persistent/temporary lifetimes passed.`);
}finally{await browser?.close();server.kill();}
