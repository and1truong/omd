import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,failWrites} from './store-helper.js';
import {emptyNotebook,makeBlock,STORAGE_KEY} from '../src/model.ts';
import {wrapPage} from '../src/notebook.ts';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
test('selection is tab-local, writes no revision/history and reload hydrates the same tab page',async()=>{
  const data=memory(),a=await createStore(data,{initial:emptyNotebook}),first=a.getActivePageId();
  const second=(await a.dispatch('page_add',{title:'Second'})).pageId;
  const b=await createStore(data,{activePageId:second}),revision=a.getRevision(),history=a.residency().undoEntries,writes=trace(a);
  try{
    await a.dispatch('page_select',{pageId:first});
    assert.equal(a.getRevision(),revision);assert.equal(a.residency().undoEntries,history);assert.deepEqual(writes.puts,[]);
    await b.reload();assert.equal(b.getActivePageId(),second);
    await a.dispatch('set_page',{title:'First edited'});await b.reload();
    assert.equal(b.getActivePageId(),second);assert.equal((await b.getPage(first)).title,'First edited');
    await b.dispatch('set_page',{title:'Second edited'});await a.reload();
    assert.equal(a.getActivePageId(),first);assert.equal((await a.getPage(second)).title,'Second edited');
    await a.dispatch('page_select',{pageId:second});await a.dispatch('set_page',{title:'Undo me'});await a.dispatch('page_select',{pageId:first});await a.undo();
    assert.equal(a.getActivePageId(),first);assert.equal((await a.getPage(second)).title,'Second edited');
    await b.reload();await b.dispatch('page_remove',{pageId:first});await a.reload();assert.equal(a.getActivePageId(),second);
    await assert.rejects(()=>a.dispatch('page_select',{pageId:'missing'}),/not found/i);
  }finally{writes.stop();await a.close();await b.close();}
});
function trace(store){const puts=[],reads=[],put=IDBObjectStore.prototype.put,getAll=IDBIndex.prototype.getAll;
  IDBObjectStore.prototype.put=function(value,key){if(this.transaction.db.name===store.databaseName())puts.push({store:this.name,key,value});return put.call(this,value,key);};
  IDBIndex.prototype.getAll=function(query,...args){if(this.objectStore.transaction.db.name===store.databaseName())reads.push(query);return getAll.call(this,query,...args);};
  return {puts,reads,clear(){puts.length=reads.length=0;},stop(){IDBObjectStore.prototype.put=put;IDBIndex.prototype.getAll=getAll;}};
}
test('leaf events preserve sibling identity, notify only the selected block and write only touched records',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook});
  const a=(await store.dispatch('add_block',{type:'text',text:'a'})).blockId,b=(await store.dispatch('add_block',{type:'text',text:'b'})).blockId;
  const sibling=store.getRenderState().blocks[1],events=[];store.subscribeBlock(a,()=>events.push(a));store.subscribeBlock(b,()=>events.push(b));const writes=trace(store);
  try {await store.dispatch('update_block',{blockId:a,patch:{text:'changed'}});assert.equal(store.getRenderState().blocks[1],sibling);assert.deepEqual(events,[a]);
    assert.deepEqual(writes.puts.filter(p=>p.store==='records').map(p=>[p.value.kind,p.value.id]).sort(),[['block',a],['page',store.getActivePageId()]].sort());assert.deepEqual(writes.reads,[]);
    assert.ok(writes.puts.filter(p=>p.store==='records').every(p=>p.key===undefined&&!Object.hasOwn(p.value,'key')));
    const history=writes.puts.find(p=>p.store==='history').value;assert.ok(history.changes.every(p=>p.inverse&&p.forward));assert.ok(!JSON.stringify(history).includes('"text":"b"'));
  }finally{writes.stop();store.close();}
});
test('changing pages releases payloads; metadata navigation never reads unrelated content',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),first=store.getActivePageId();
  await store.dispatch('add_block',{type:'text',text:'first'});const second=(await store.dispatch('page_add',{title:'Second'})).pageId;
  const scene=makeBlock('excalidraw').scene;scene.files.image={id:'image',dataURL:'data:image/png;base64,'+'A'.repeat(200000)};
  await store.dispatch('add_block',{type:'excalidraw',scene});await store.dispatch('page_select',{pageId:first});const writes=trace(store);
  try {await store.dispatch('update_block',{blockId:store.getRenderState().blocks[0].id,patch:{text:'edit'}});store.listPages();await store.reload();
    assert.deepEqual(writes.reads,[]);assert.equal(store.residency().pageId,first);assert.equal(store.residency().recordCount,3);
    writes.clear();await store.dispatch('page_select',{pageId:second});assert.deepEqual(writes.reads,[second]);assert.equal(store.residency().recordCount,5);
  }finally{writes.stop();store.close();}
});
test('canvas title changes do not read or write scene records',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),id=(await store.dispatch('add_block',{type:'excalidraw'})).blockId;
  const scene=store.getRenderState().blocks[0].scene,writes=trace(store);
  try{await store.dispatch('update_block',{blockId:id,patch:{title:'New title'}});assert.equal(store.getRenderState().blocks[0].scene,scene);assert.ok(!writes.puts.some(p=>p.store==='records'&&p.value.kind==='scene'));assert.deepEqual(writes.reads,[]);}finally{writes.stop();store.close();}
});
test('undo reads touched records and preserves the unrelated block instance',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook});const id=(await store.dispatch('add_block',{type:'text',text:'old'})).blockId;await store.dispatch('add_block',{type:'text',text:'sibling'});
  await store.dispatch('update_block',{blockId:id,patch:{text:'new'}});const sibling=store.getRenderState().blocks[1],writes=trace(store);
  try {await store.undo();assert.equal(store.getRenderState().blocks[0].text,'old');assert.equal(store.getRenderState().blocks[1],sibling);assert.deepEqual(writes.reads,[]);await store.redo();assert.equal(store.getRenderState().blocks[0].text,'new');}finally{writes.stop();store.close();}
});
test('transaction abort publishes no selector updates, does not advance history and can be retried',async()=>{
  const data=memory(),store=await createStore(data,{initial:emptyNotebook}),before=await store.export(),events=[];store.subscribe(()=>events.push(true));const statuses=[];store.subscribeStatus(s=>statuses.push(s));const recover=failWrites(store);
  try{await assert.rejects(()=>store.dispatch('set_page',{title:'lost'}),/Could not save/);}finally{recover();}
  assert.equal(await store.export(),before);assert.equal(store.canUndo(),false);assert.deepEqual(events,[]);assert.ok(statuses.some(s=>s.pending>0));assert.ok(statuses.some(s=>s.error));await store.reload();assert.ok(statuses.at(-1).error,'Unchanged reminder polling must not erase a failed-save status.');
  await store.dispatch('set_page',{title:'saved'});assert.equal((await createStore(data)).getState().title,'saved');store.close();
});
test('queued events are ordered and a stale transaction cannot overwrite a concurrent commit',async()=>{
  const data=memory(),a=await createStore(data,{initial:emptyNotebook}),b=await createStore(data);
  const results=await Promise.all([a.dispatch('set_page',{title:'one'}),a.dispatch('set_page',{title:'two'})]);assert.deepEqual(results.map(r=>r.revision),[1,2]);
  await assert.rejects(()=>b.dispatch('set_page',{title:'stale'}),/Another window/);await b.reload();await b.dispatch('set_page',{title:'three'});assert.equal((await createStore(data)).getState().title,'three');a.close();b.close();
});
test('reminder polling uses an index across unloaded pages without hydrating their payloads',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),first=store.getActivePageId(),second=(await store.dispatch('page_add',{})).pageId;
  await store.dispatch('add_block',{type:'reminder',dueAt:'2020-01-01T00:00:00Z'});await store.dispatch('page_select',{pageId:first});const writes=trace(store);
  try{const due=await store.dueReminders(Date.now());assert.equal(due.length,1);assert.equal(due[0].pageId,second);assert.equal(store.residency().pageId,first);assert.equal(writes.reads.length,1);assert.ok(writes.reads[0] instanceof IDBKeyRange);}finally{writes.stop();store.close();}
});
test('migration is atomic in IndexedDB, retains raw v3 bytes and competing initializations share one notebook',async()=>{
  const data=memory(),book=wrapPage(emptyNotebook()),raw=JSON.stringify(book);data.setItem(STORAGE_KEY,raw);
  const [a,b]=await Promise.all([createStore(data),createStore(data)]);assert.equal((await a.getNotebook()).id,(await b.getNotebook()).id);assert.equal(data.getItem(STORAGE_KEY),raw);
  data.setItem=()=>{throw new Error('localStorage quota');};await a.dispatch('set_page',{title:'IndexedDB edit'});assert.equal(a.getState().title,'IndexedDB edit');a.close();b.close();
});
test('a failed initial record write aborts migration completely and the unchanged source can be retried',async()=>{
  const data=memory(),page=emptyNotebook();page.blocks=[makeBlock('text',{text:'original'})];const raw=JSON.stringify(page);data.setItem(STORAGE_KEY,raw);
  const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args){if(this.name==='records')throw new DOMException('Could not save: quota.','QuotaExceededError');return put.apply(this,args);};
  try{await assert.rejects(()=>createStore(data),/quota/);}finally{IDBObjectStore.prototype.put=put;}
  assert.equal(data.getItem(STORAGE_KEY),raw);const restored=await createStore(data);assert.equal(restored.getState().blocks[0].text,'original');restored.close();
});
async function journalRows(store){return new Promise((resolve,reject)=>{const opening=indexedDB.open(store.databaseName());opening.onerror=()=>reject(opening.error);opening.onsuccess=()=>{const db=opening.result,tx=db.transaction('history'),get=tx.objectStore('history').getAll();get.onsuccess=()=>resolve(get.result);get.onerror=()=>reject(get.error);tx.oncomplete=()=>db.close();};});}
test('redo branches, reload and close prune unreachable journals without deleting another open store history',async()=>{
  const data=memory(),a=await createStore(data,{initial:emptyNotebook});await a.dispatch('set_page',{title:'one'});await a.dispatch('set_page',{title:'two'});assert.equal((await journalRows(a)).length,2);
  await a.undo();await a.dispatch('set_page',{title:'three'});assert.equal((await journalRows(a)).length,2,'Abandoned redo journal must be deleted in the new commit.');
  const b=await createStore(data);await b.dispatch('set_page',{title:'four'});await a.reload();assert.equal((await journalRows(b)).length,1);await a.close();assert.equal((await journalRows(b)).length,1);
  await b.undo();assert.equal(b.getState().title,'three');await b.close();assert.equal((await journalRows(b)).length,0);
});
test('Web Lock leases preserve live tab journals and reclaim abandoned session journals on reopening',async()=>{
  const held=new Map();const locks={request(name,options,callback){if(typeof options==='function'){callback=options;options={};}if(held.has(name))return Promise.resolve(callback(null));held.set(name,true);const result=Promise.resolve(callback({name}));result.finally(()=>held.delete(name));return result;}};
  const data=memory(),a=await createStore(data,{initial:emptyNotebook,locks});await a.dispatch('set_page',{title:'saved'});
  const b=await createStore(data,{locks});assert.equal((await journalRows(b)).length,1,'A live session keeps its journal.');await b.close();
  held.clear(); // Simulate a killed document: the browser releases its Web Locks.
  const c=await createStore(data,{locks});assert.equal((await journalRows(c)).length,0);assert.equal(c.getState().title,'saved');await a.close();await c.close();
});
test('drawing edits neither rewrite unchanged image bytes nor duplicate them into the undo journal',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),scene=makeBlock('excalidraw').scene;scene.files.image={id:'image',dataURL:'data:image/png;base64,'+'A'.repeat(200000)};
  const id=(await store.dispatch('add_block',{type:'excalidraw',scene})).blockId,changed=structuredClone(store.getRenderState().blocks[0].scene);changed.elements.push({id:'shape',type:'rectangle',x:1,y:1,width:50,height:50});const writes=trace(store);
  try{await store.dispatch('update_block',{blockId:id,patch:{scene:changed}});assert.ok(!writes.puts.some(p=>p.store==='records'&&p.value.kind==='files'));assert.ok(!JSON.stringify(writes.puts.find(p=>p.store==='history').value).includes('data:image'));await store.undo();assert.equal(store.getRenderState().blocks[0].scene.elements.length,0);assert.equal(store.getRenderState().blocks[0].scene.files.image.dataURL,scene.files.image.dataURL);}finally{writes.stop();await store.close();}
});
test('older IndexedDB scene records upgrade atomically to separate image-file maps',async()=>{
  const data=memory(),name=`old-preview-${crypto.randomUUID()}`,page=emptyNotebook(),drawing=makeBlock('excalidraw'),book=wrapPage(page);drawing.scene.files.image={id:'image',dataURL:'data:image/png;base64,AA=='};
  await new Promise((resolve,reject)=>{const opening=indexedDB.open(name,1);opening.onupgradeneeded=()=>{const db=opening.result;db.createObjectStore('meta');db.createObjectStore('records').createIndex('pageId','pageId');db.createObjectStore('reminders').createIndex('due','due');db.createObjectStore('history');db.createObjectStore('delivery');};opening.onerror=()=>reject(opening.error);opening.onsuccess=()=>{const db=opening.result,tx=db.transaction(['meta','records'],'readwrite'),records=tx.objectStore('records');tx.objectStore('meta').put(book,'book');const add=(id,kind,record)=>{const key=JSON.stringify([page.id,id]);records.put({key,kind,pageId:page.id,data:record},key);};const {blocks,...metadata}=page;add('$page','page',metadata);add('$container:page','container',{id:'page',blockIds:[drawing.id]});add(`$block:${drawing.id}`,'block',{id:drawing.id,type:'excalidraw',title:drawing.title});add(`$scene:${drawing.id}`,'scene',drawing.scene);tx.oncomplete=()=>{db.close();resolve();};tx.onabort=()=>reject(tx.error);};});
  const {createStore:openStore}=await import('../src/store.ts'),store=await openStore(data,{name,initial:emptyNotebook});assert.deepEqual(store.getRenderState().blocks[0].scene,drawing.scene);assert.equal(store.residency().recordCount,5);await store.close();
});
