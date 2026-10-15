import assert from 'node:assert/strict';
import {startCloudflare} from './cloudflare-helper.mjs';
import {createStore} from '../src/store.ts';
import {openCloudflareRepository} from '../src/cloudflare-repository.ts';
import {emptyNotebook,makeBlock} from '../src/model.ts';
import {metadataBook,pageRecords,recordChanges} from '../src/records.ts';
import {applyBookAction} from '../src/notebook.ts';

const worker=await startCloudflare({diagnostics:true}),endpoint=worker.url+'/api/notebook',nativeFetch=globalThis.fetch,measurements=[];
let store,repository;
globalThis.fetch=async(...args)=>{
  const response=await nativeFetch(...args);
  if(String(args[0])===endpoint){
    const metric={operation:JSON.parse(args[1].body).operation,status:response.status,count:Number(response.headers.get('x-test-d1-count')),rows:Number(response.headers.get('x-test-d1-record-rows')),pages:JSON.parse(response.headers.get('x-test-d1-record-pages')),kinds:JSON.parse(response.headers.get('x-test-d1-record-kinds')),bindBytes:Number(response.headers.get('x-test-d1-max-bind-bytes'))};
    assert.ok(metric.count<=50,JSON.stringify(metric));assert.ok(metric.bindBytes<=2_000_000,JSON.stringify(metric));measurements.push(metric);
  }
  return response;
};
const last=()=>measurements.at(-1);
const rpc=async(operation,input={})=>{const response=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,session:'limits-regression',...input})}),body=await response.json();assert.equal(response.status,200,body.error);return body.result;};
try{
  store=await createStore({getItem:()=>null,setItem:()=>{}},{cloudEndpoint:endpoint});repository=await openCloudflareRepository(endpoint);
  const bulk=await store.getNotebook();bulk.pages[0].blocks=Array.from({length:1005},()=>makeBlock('reminder',{dueAt:'2099-01-01T00:00:00Z'}));
  await store.import(JSON.stringify(bulk));assert.equal(last().operation,'commit');assert.ok(last().count<50);await store.undo();assert.equal(store.getState().blocks.length,0);await store.redo();assert.equal(store.getState().blocks.length,1005);
  const book=await store.getNotebook(),small=emptyNotebook(),heavy=emptyNotebook(),largeText='💡'.repeat(550_000);
  small.title='Small active page';small.blocks=[makeBlock('text',{text:'A small note'}),makeBlock('reminder',{title:'A long reminder 💡'.repeat(6000),dueAt:'2020-01-01T00:00:00Z'})];
  heavy.title='Unrelated images';heavy.blocks=[makeBlock('excalidraw',{scene:{elements:[],appState:{},files:{image:{id:'image',dataURL:'data:image/png;base64,'+'A'.repeat(2_100_000)}}}})];
  book.pages.push(small,heavy);book.parents[small.id]=book.parents[heavy.id]='';book.activePageId=small.id;await store.import(JSON.stringify(book));assert.ok(last().bindBytes<2_000_000);
  // A single large record is split both into D1 rows and bounded json_each bindings.
  await store.dispatch('add_block',{type:'text',text:largeText});assert.ok(last().count<50);assert.ok(last().bindBytes<2_000_000);await store.undo();await store.redo();await store.undo();
  const initial=await rpc('read',{preferredPageId:small.id});assert.deepEqual(last().pages,[small.id]);assert.equal(initial.meta.activePageId,small.id);assert.ok(last().rows<20);
  await rpc('read',{expected:initial.meta,preferredPageId:small.id});assert.equal(last().rows,0);
  await rpc('page',{pageId:small.id});assert.deepEqual(last().pages,[small.id]);assert.ok(!last().kinds.includes('files'));
  const key=[small.id,'block',small.blocks[0].id];await rpc('records',{keys:[key,key,[small.id,'block','missing']]});assert.equal(last().rows,1);assert.deepEqual(last().pages,[small.id]);
  const repeated=await rpc('records',{keys:Array(15000).fill(key)});assert.equal(repeated.length,15000);assert.ok(repeated.every(row=>row.id===key[2]));assert.deepEqual(last().pages,[small.id]);
  await rpc('receipt',{bridge:{notebookId:initial.meta.id,expectedRevision:initial.meta.revision,idempotencyKey:'absent',semantic:'lookup only'}});assert.equal(last().rows,0);
  const due=await rpc('due',{now:Date.now()});assert.equal(due.length,1);assert.equal(due[0].title,small.blocks[1].title);assert.ok(last().kinds.every(kind=>kind==='block'));assert.ok(!last().pages.includes(heavy.id));
  // Pre-migration records have a NULL type hint; even chunked reminders remain readable.
  worker.sql(`UPDATE records SET block_type=NULL WHERE page_id='${small.id}' AND kind='block'`);assert.equal((await rpc('due',{now:Date.now()}))[0].title,small.blocks[1].title);
  // Long history lists must use bounded bulk SQL too, with no per-ID query loop.
  await rpc('pruneHistory',{ids:Array.from({length:1500},(_,i)=>'history-'+i)});assert.ok(last().count<10);
  const current=await repository.export(),before=metadataBook(current),changed=applyBookAction(current,'set_page',{title:'Scoped commit',pageId:small.id}).state,next=metadataBook(changed),delta=recordChanges(pageRecords(current.pages.find(p=>p.id===small.id)),pageRecords(changed.pages.find(p=>p.id===small.id)));
  const journalId=crypto.randomUUID();
  await repository.commit(before,next,delta,{deleteHistory:Array.from({length:1500},(_,i)=>'obsolete-'+i),journalId,journal:{owner:'limits-history',before,after:next,changes:[]}});assert.ok(last().count<50);assert.deepEqual(last().pages,[small.id]);assert.equal((await repository.history(journalId)).owner,'limits-history');
  worker.sql(`INSERT INTO history VALUES('another-session','${journalId}','another-owner',0,'{}',${Date.now()})`);
  await repository.pruneHistory([...Array.from({length:1500},(_,i)=>'absent-'+i),journalId]);assert.ok(last().count<10);await assert.rejects(()=>repository.history(journalId),/no longer available/);assert.equal(worker.sql(`SELECT COUNT(*) AS n FROM history WHERE session='another-session' AND id='${journalId}'`)[0].n,1);
  // Scope reduction must not weaken rejection of inconsistent page metadata/deletion.
  const saved=await repository.export(),expected=metadataBook(saved),bad={...expected,revision:expected.revision+1,pages:expected.pages.map(page=>page.id===heavy.id?{...page,title:'Unsaved metadata'}:page)};
  await assert.rejects(()=>repository.commit(expected,bad,[]),/inconsistent/);assert.equal((await repository.export()).revision,expected.revision);
  const removed=applyBookAction(saved,'page_remove',{pageId:heavy.id}).state;
  await assert.rejects(()=>repository.commit(expected,metadataBook(removed),[]),/inconsistent/);assert.equal((await repository.export()).revision,expected.revision);
  const commits=measurements.filter(metric=>metric.operation==='commit'&&metric.status===200);console.log(`Production D1 limits: ${commits.length} commits, maximum ${Math.max(...commits.map(metric=>metric.count))}/50 statements, largest binding ${Math.max(...measurements.map(metric=>metric.bindBytes))}/2000000 bytes. Bulk import/undo/redo, large Unicode/image records, history pruning, scoped reads/commits, legacy chunked reminders and validation passed.`);
}finally{await store?.close().catch(()=>{});repository?.close();globalThis.fetch=nativeFetch;await worker.stop();}
