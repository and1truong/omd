import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from './store-helper.js';
import {emptyNotebook} from '../src/model.ts';
import {createBridge,registerBridge} from '../src/bridge.ts';
import {hostSafeSchema,withinMessageCap} from '../src/bridge-engine.ts';
const memory=()=>{const data=new Map();return {getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value)};};
const call=(context,toolName,args,extra={})=>({requestId:crypto.randomUUID(),documentId:context.documentId,toolName,arguments:args,expectedRevision:context.revision,idempotencyKey:crypto.randomUUID(),...extra});

test('Bridge catalog reuses domain commands, pins page IDs and remains wrappable by Lime',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook});
  try{
    const target={},bridge=registerBridge(store,{},target),description=await bridge.describe(),context=await bridge.getContext();
    assert.equal(description.protocolVersion,'0.1');assert.equal(description.appId,'omd');assert.equal(Object.isFrozen(bridge),true);
    assert(description.tools.every(t=>hostSafeSchema(t.inputSchema)));assert(withinMessageCap(description));
    assert.equal(description.tools.find(t=>t.name==='omd_remove_block').effect,'destructive');
    for(const name of ['omd_add_block','omd_set_page','omd_excalidraw_set_scene'])assert(description.tools.find(t=>t.name===name).inputSchema.required.includes('pageId'));
    assert(!description.tools.some(t=>['omd_import_notebook','omd_set_view','omd_page_select'].includes(t.name)));
    target.agentBridgeV1=Object.freeze({...bridge,requestAgentTurn:async()=> 'proposal only'});assert.equal(await target.agentBridgeV1.requestAgentTurn(),'proposal only');
    assert.match(context.documentId,/^omd-[a-f0-9]{64}$/);assert.equal(context.selectionIds[0],store.getActivePageId());
    const read=call(context,'omd_get_page',{pageId:context.selectionIds[0]},{expectedRevision:null,idempotencyKey:null});
    assert.equal((await bridge.invoke(read)).ok,true);
    for(const bad of [{...read,approved:true},{...read,expectedRevision:0},{...read,requestId:'x'.repeat(129)},call(context,'omd_add_block',{type:'text'}),call(context,'omd_set_page',{pageId:context.selectionIds[0],theme:'dark'})])assert.equal((await bridge.invoke(bad)).error.code,'INVALID_ARGUMENT');
    assert.equal((await bridge.invoke({...read,toolName:'unknown'})).error.code,'UNSUPPORTED');
    assert.equal((await bridge.invoke({...read,documentId:'foreign'})).error.code,'STALE_CONTEXT');
  }finally{await store.close();}
});

test('mutation, durable retry, conflict and stale checks share the actual IndexedDB transaction',async()=>{
  const data=memory(),a=await createStore(data,{initial:emptyNotebook}),b=await createStore(data);
  let aClosed=false;
  const first=createBridge(a),second=createBridge(b),context=await first.getContext(),pageId=context.selectionIds[0];
  const request=call(context,'omd_add_block',{pageId,type:'text',text:'exactly one'});
  try{
    const [one,two]=await Promise.all([first.invoke(request),second.invoke({...request,requestId:'parallel'})]);
    assert.equal(one.ok,true);assert.deepEqual(two,one);assert.equal(a.getRevision(),1);
    await b.reload();assert.equal(b.getState().blocks.length,1);
    assert.equal((await first.invoke({...request,arguments:{...request.arguments,text:'different'}})).error.code,'IDEMPOTENCY_CONFLICT');
    assert.equal((await first.invoke({...request,idempotencyKey:'new-key'})).error.code,'STALE_CONTEXT');
    const changed=await first.getContext(),blockId=one.data.blockId;
    const removal=call(changed,'omd_remove_block',{pageId,blockId});const removed=await first.invoke(removal);assert.equal(removed.ok,true);
    assert.deepEqual(await second.invoke({...removal,requestId:'delete-retry'}),removed,'Deleted IDs must replay before entity lookup');
    await a.close();aClosed=true;const reopened=await createStore(data);
    try{assert.deepEqual(await createBridge(reopened).invoke({...request,requestId:'restart'}),one);assert.equal(reopened.getState().blocks.length,0);assert.equal(reopened.getRevision(),2);const exported=await reopened.export();assert(!exported.includes('idempotencyKey'));assert(!exported.includes(request.idempotencyKey));}
    finally{await reopened.close();}
  }finally{if(!aClosed)await a.close();await b.close();}
});

test('failed receipt writes roll back records, revision and history; a later retry applies once',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),bridge=createBridge(store),context=await bridge.getContext(),request=call(context,'omd_add_block',{pageId:context.selectionIds[0],type:'text',text:'atomic'});
  const put=IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put=function(value,key){if(this.transaction.db.name===store.databaseName()&&this.name==='meta'&&Array.isArray(key)&&key[0]==='agent-bridge')throw new DOMException('Receipt quota failure','QuotaExceededError');return put.call(this,value,key);};
  try{assert.equal((await bridge.invoke(request)).error.code,'INTERNAL');assert.equal(store.getRevision(),0);assert.equal(store.canUndo(),false);assert.equal(store.getState().blocks.length,0);}
  finally{IDBObjectStore.prototype.put=put;}
  try{const success=await bridge.invoke(request);assert.equal(success.ok,true);assert.deepEqual(await bridge.invoke(request),success);assert.equal(store.getState().blocks.length,1);}
  finally{await store.close();}
});

test('an approval never re-resolves the active page; UI writes and imports revoke stale requests',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),bridge=createBridge(store),first=store.getActivePageId();
  try{
    const second=(await store.dispatch('page_add',{title:'Second'})).pageId;
    const context=await bridge.getContext(),request=call(context,'omd_add_block',{pageId:first,type:'text',text:'pinned'});
    const result=await bridge.invoke(request);assert.equal(result.ok,true);assert.equal(store.getActivePageId(),second);assert.equal((await store.getPage(first)).blocks.length,1);assert.equal(store.getState().blocks.length,0);
    const stale=call(await bridge.getContext(),'omd_add_block',{pageId:first,type:'text'});await store.dispatch('set_page',{pageId:second,title:'UI edit'});assert.equal((await bridge.invoke(stale)).error.code,'STALE_CONTEXT');
    await store.import(JSON.stringify(emptyNotebook()));assert.equal((await bridge.invoke(request)).error.code,'STALE_CONTEXT');
  }finally{await store.close();}
});

test('wire caps do not impose notebook quotas; bounded block reads remain available',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),bridge=createBridge(store);
  try{
    const pageId=store.getActivePageId();await store.dispatch('add_block',{pageId,type:'text',text:'x'.repeat(70000)});await store.dispatch('add_block',{pageId,type:'text',text:'small'});
    const context=await bridge.getContext(),read=(name,args)=>bridge.invoke(call(context,name,args,{expectedRevision:null,idempotencyKey:null}));
    assert.equal((await read('omd_get_page',{pageId})).error.code,'INVALID_ARGUMENT');
    const blocks=await read('omd_list_blocks',{pageId,limit:1});assert.equal(blocks.ok,true);assert.equal(blocks.data.nextOffset,1);
    assert.equal((await read('omd_get_block',{pageId,blockId:store.getState().blocks[1].id})).data.block.text,'small');
    assert.equal((await bridge.invoke(call(context,'omd_add_block',{pageId,type:'text',text:'x'.repeat(70000)}))).error.code,'INVALID_ARGUMENT');
    assert.equal(store.getRevision(),2);
  }finally{await store.close();}
});
