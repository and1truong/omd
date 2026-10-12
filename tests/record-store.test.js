import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore,failWrites} from './store-helper.js';
import {emptyNotebook,makeBlock,STORAGE_KEY} from '../src/model.js';
import {wrapPage} from '../src/notebook.js';
const memory=()=>{const values=new Map();return {getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v)};};
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
    assert.deepEqual(writes.puts.filter(p=>p.store==='records').map(p=>JSON.parse(p.key)[1]).sort(),[`$block:${a}`,'$page'].sort());assert.deepEqual(writes.reads,[]);
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
    writes.clear();await store.dispatch('page_select',{pageId:second});assert.deepEqual(writes.reads,[second]);assert.equal(store.residency().recordCount,4);
  }finally{writes.stop();store.close();}
});
test('canvas title changes do not read or write scene records',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),id=(await store.dispatch('add_block',{type:'excalidraw'})).blockId;
  const scene=store.getRenderState().blocks[0].scene,writes=trace(store);
  try{await store.dispatch('update_block',{blockId:id,patch:{title:'New title'}});assert.equal(store.getRenderState().blocks[0].scene,scene);assert.ok(!writes.puts.some(p=>p.store==='records'&&p.key.includes('$scene:')));assert.deepEqual(writes.reads,[]);}finally{writes.stop();store.close();}
});
test('undo reads touched records and preserves the unrelated block instance',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook});const id=(await store.dispatch('add_block',{type:'text',text:'old'})).blockId;await store.dispatch('add_block',{type:'text',text:'sibling'});
  await store.dispatch('update_block',{blockId:id,patch:{text:'new'}});const sibling=store.getRenderState().blocks[1],writes=trace(store);
  try {await store.undo();assert.equal(store.getRenderState().blocks[0].text,'old');assert.equal(store.getRenderState().blocks[1],sibling);assert.deepEqual(writes.reads,[]);await store.redo();assert.equal(store.getRenderState().blocks[0].text,'new');}finally{writes.stop();store.close();}
});
test('transaction abort publishes no selector updates, does not advance history and can be retried',async()=>{
  const data=memory(),store=await createStore(data,{initial:emptyNotebook}),before=await store.export(),events=[];store.subscribe(()=>events.push(true));const statuses=[];store.subscribeStatus(s=>statuses.push(s));const recover=failWrites(store);
  try{await assert.rejects(()=>store.dispatch('set_page',{title:'lost'}),/Could not save/);}finally{recover();}
  assert.equal(await store.export(),before);assert.equal(store.canUndo(),false);assert.deepEqual(events,[]);assert.ok(statuses.some(s=>s.pending>0));assert.ok(statuses.some(s=>s.error));
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
