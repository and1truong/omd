import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readdir,readFile} from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
const root=new URL('..',import.meta.url).pathname,engine=process.env.OMD_BROWSER??'chromium',base=process.env.OMD_BASE_PATH??'';
const server=spawn(process.execPath,['scripts/serve.mjs'],{cwd:root,env:{...process.env,OMD_STATIC_DIR:'dist',OMD_PORT:'4329'},stdio:['ignore','pipe','pipe']});
let browser;const errors=[],requests=[];
try {
  await new Promise((resolve,reject)=>{server.stdout.once('data',resolve);server.once('error',reject);});
  browser=await ({chromium,webkit}[engine]).launch({headless:true});const context=await browser.newContext(),page=await context.newPage();
  page.on('pageerror',error=>errors.push(error.message));page.on('request',r=>requests.push(r.url()));
  const init=()=>page.evaluate(async()=>{window.app=await import(new URL('./src/app.js',document.baseURI).href);await window.app.ready;window.store=window.app.getStore();});
  await page.goto(`http://localhost:4329${base}/`);await init();
  const call=(name,input)=>page.evaluate(async({name,input})=>{await window.app.flushPending();return window.store.dispatch(name,input);},{name,input});
  await call('page_add',{title:'Patched dependency compatibility'});
  const katexChunk=(await readdir(new URL('../dist/src/chunks/',import.meta.url))).find(name=>/^katex-.*\.js$/.test(name));assert.ok(katexChunk,'Production bundle must include its actual KaTeX chunk.');
  await page.evaluate(async name=>{const {default:katex}=await import(new URL(`src/chunks/${name}`,document.baseURI).href);const host=document.createElement('div');host.id='bundled-math-check';host.innerHTML=katex.renderToString('\\frac{a}{b}+\\sqrt{x}',{throwOnError:true});document.body.append(host);},katexChunk);
  await page.locator('#bundled-math-check .katex').waitFor();assert.ok(await page.locator('#bundled-math-check math mfrac').count());
  const inheritedTrustLinks=await page.evaluate(async name=>{
    const {default:katex}=await import(new URL(`src/chunks/${name}`,document.baseURI).href);
    Object.prototype.trust=true;
    try {const html=katex.renderToString('\\href{https://example.com}{link}',{throwOnError:false});return new DOMParser().parseFromString(html,'text/html').querySelectorAll('a[href]').length;}
    finally{delete Object.prototype.trust;}
  },katexChunk);
  assert.equal(inheritedTrustLinks,0,'Inherited trust must not enable KaTeX links (GHSA-238p-pmpm-9mq7).');
  const chunkDirectory=new URL('../dist/src/chunks/',import.meta.url);let converterChunk;
  for(const name of await readdir(chunkDirectory))if(name.endsWith('.js')&&/export\s*\{[^}]*\bparseMermaidToExcalidraw\b/.test(await readFile(new URL(name,chunkDirectory),'utf8'))){converterChunk=name;break;}
  assert.ok(converterChunk,'Find the actual shipped Mermaid-to-Excalidraw module.');
  const conversion=await page.evaluate(async name=>{const {parseMermaidToExcalidraw}=await import(new URL(`src/chunks/${name}`,document.baseURI).href);const results=[];for(const source of ['flowchart LR\n Alpha --> Beta','sequenceDiagram\n Alice->>Bob: Hello','classDiagram\n Animal <|-- Dog']){const result=await parseMermaidToExcalidraw(source);results.push(result);}return results;},converterChunk);
  // The converter returns Excalidraw element skeletons; some text/arrow
  // skeletons deliberately omit IDs for Excalidraw to assign on insertion.
  for(const {elements}of conversion){assert.ok(elements.length>0);const ids=elements.filter(element=>element.id!==undefined).map(element=>element.id);assert.ok(ids.every(id=>typeof id==='string'&&id.length>0));assert.equal(new Set(ids).size,ids.length,'Patched ID generation must not duplicate generated element IDs.');}
  const diagram=(await call('add_block',{type:'mermaid',source:'flowchart LR\n A[Start] --> B[Done]'})).blockId;
  const preview=page.locator(`[data-block-id="${diagram}"] [data-mermaid-preview]`);
  await preview.locator('svg').waitFor();
  for(const source of ['sequenceDiagram\n Alice->>Bob: Hello','classDiagram\n Animal <|-- Dog','flowchart LR\n A["$$\\frac{a}{b}+\\sqrt{x}$$"] --> B["$$x^2$$"]']){
    await page.locator(`[id="${diagram}-source"]`).fill(source);await page.waitForFunction(()=>!!document.querySelector('.mermaid-preview svg'));
    // Wait for a render that contains the changed source, not the previous SVG.
    if(source.startsWith('sequence'))await page.waitForFunction(()=>document.querySelector('.mermaid-preview')?.textContent.includes('Hello'));
    if(source.startsWith('class'))await page.waitForFunction(()=>document.querySelector('.mermaid-preview')?.textContent.includes('Animal'));
    // OMD's strict SVG labels (htmlLabels:false) retain formula delimiters as
    // text. Exercise the shipped KaTeX chunk separately above, without changing
    // the application's security configuration to make the fixture render.
    if(source.includes('$$'))await page.waitForFunction(()=>document.querySelector('.mermaid-preview')?.textContent.includes('$$x^2$$'));
    assert.equal(await page.locator('.diagram-error').innerText(),'');
  }
  const drawing=(await call('add_block',{type:'excalidraw'})).blockId;
  await page.locator(`[data-block-id="${drawing}"] .excalidraw canvas`).first().waitFor();
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const scene={elements:[{id:'dependency-shape',type:'rectangle',x:40,y:40,width:140,height:80},{id:'dependency-text',type:'text',x:40,y:140,width:180,height:25,text:'Patched canvas fonts',fontSize:20,fontFamily:5},{id:'dependency-image',type:'image',x:240,y:40,width:40,height:40,fileId:'image',status:'saved',scale:[1,1]}],appState:{},files:{image:{id:'image',dataURL:png,mimeType:'image/png',created:1,lastRetrieved:1}}};
  await call('update_block',{blockId:drawing,patch:{scene}});
  await page.waitForFunction(id=>window.store.getState().blocks.find(b=>b.id===id)?.scene.elements.some(e=>e.id==='dependency-shape'&&e.version),drawing);
  await page.evaluate(()=>window.app.flushPending());await page.evaluate(()=>document.fonts.ready);
  const portable=await page.evaluate(()=>window.store.export()),book=JSON.parse(portable),saved=book.pages.find(p=>p.id===book.activePageId).blocks.find(b=>b.id===drawing).scene;
  assert.equal(saved.files.image.dataURL,png);assert.ok(saved.elements.some(e=>e.type==='text'&&e.text==='Patched canvas fonts'));assert.ok(saved.elements.some(e=>e.type==='image'&&e.fileId==='image'));
  assert.ok(requests.some(url=>/\.woff2(?:$|\?)/.test(url)),'Canvas/math fonts must load from bundled assets.');
  await page.evaluate(async json=>{await window.store.import(json);await window.app.flushPending();},portable);
  await page.locator(`[data-block-id="${drawing}"] .excalidraw canvas`).first().waitFor();await preview.locator('svg').waitFor();
  await page.getByRole('button',{name:'Open canvas full page',exact:true}).click();await page.getByRole('button',{name:'Back to notebook',exact:true}).click();
  await page.evaluate(async()=>{await window.app.flushPending();await navigator.serviceWorker.ready;});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill();await stopped;
  await page.reload();await init();await page.locator(`[data-block-id="${drawing}"] .excalidraw canvas`).first().waitFor();await preview.locator('svg').waitFor();
  assert.ok(await page.evaluate(async name=>{const {default:katex}=await import(new URL(`src/chunks/${name}`,document.baseURI).href);return katex.renderToString('x^2',{throwOnError:true}).includes('<math');},katexChunk),'Bundled math must remain available after origin shutdown.');
  assert.equal(await page.evaluate(id=>window.store.getState().blocks.find(b=>b.id===id).scene.files.image.dataURL,drawing),png);
  await page.locator(`[id="${diagram}-source"]`).fill('flowchart LR\n Offline["$$x+1$$"] --> Cached');await page.waitForFunction(()=>document.querySelector('.mermaid-preview')?.textContent.includes('Cached'));
  await page.evaluate(()=>window.app.flushPending());assert.deepEqual(errors,[]);await context.close();
  console.log(`${engine} ${base||'/'}: Mermaid flow/sequence/class/math, Excalidraw scenes/files/fonts, import/export, full canvas and offline reload/render passed.`);
}finally{await browser?.close();server.kill();}
