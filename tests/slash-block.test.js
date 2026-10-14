import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyNotebook,applyAction,BLOCK_TYPES} from '../src/model.ts';
import {createStore,failWrites} from './store-helper.js';

test('slash conversion retains block identity and position for every supported type',()=>{
  for(const type of BLOCK_TYPES){
    let page=emptyNotebook();const run=(name,input)=>{const result=applyAction(page,name,input);page=result.state;return result.result;};
    const first=run('add_block',{type:'text',text:'Before'}).blockId,source=run('add_block',{type:'text',text:`/${type}`}).blockId,last=run('add_block',{type:'text',text:'After'}).blockId;
    const result=run('convert_block',{blockId:source,type,expectedText:`/${type}`});
    assert.equal(result.blockId,source);assert.equal(result.block.type,type);assert.deepEqual(page.blocks.map(b=>b.id),[first,source,last]);
    if('text' in result.block)assert.ok(!result.block.text.startsWith('/'));
  }
});

test('conversion rejects changed text, non-text sources and forbidden nested tabs atomically',()=>{
  let page=emptyNotebook();const run=(name,input)=>{const result=applyAction(page,name,input);page=result.state;return result.result;};
  const outer=run('add_block',{type:'tabs',orientation:'horizontal'}).block;
  const source=run('add_block',{type:'text',text:'/tabs',containerId:outer.tabs[0].id}).blockId;
  const before=structuredClone(page);
  for(const args of [{blockId:source,type:'heading',expectedText:'/stale'},{blockId:outer.id,type:'heading',expectedText:''},{blockId:source,type:'tabs',orientation:'horizontal',expectedText:'/tabs'}])assert.throws(()=>run('convert_block',args));
  assert.deepEqual(page,before);
  const inner=run('convert_block',{blockId:source,type:'tabs',orientation:'vertical',expectedText:'/tabs'}).block;
  const deep=run('add_block',{type:'text',text:'/tabs',containerId:inner.tabs[0].id}).blockId;
  assert.throws(()=>run('convert_block',{blockId:deep,type:'tabs',expectedText:'/tabs'}),/two levels/);
  assert.equal(page.blocks[0].tabs[0].blocks[0].tabs[0].blocks[0].text,'/tabs');
});

test('conversion rolls back on save failure, supports undo/redo and persists nested records',async()=>{
  const entries=new Map(),storage={getItem:key=>entries.get(key)??null,setItem:(key,value)=>entries.set(key,value)};let store=await createStore(storage);
  await store.dispatch('page_add',{title:'Slash persistence'});const parent=(await store.dispatch('add_block',{type:'toggle'})).blockId;
  const blockId=(await store.dispatch('add_block',{type:'text',containerId:parent,text:'/table'})).blockId;
  const convert=()=>store.dispatch('convert_block',{blockId,type:'table',expectedText:'/table'});
  const restore=failWrites(store);try{await assert.rejects(convert());}finally{restore();}
  assert.equal(store.getState().blocks[0].blocks[0].text,'/table');
  await convert();const table=store.getState().blocks[0].blocks[0];assert.equal(table.type,'table');
  await store.undo();assert.equal(store.getState().blocks[0].blocks[0].text,'/table');
  await store.redo();assert.deepEqual(store.getState().blocks[0].blocks[0],table);
  const activePageId=store.getActivePageId();await store.close();store=await createStore(storage,{activePageId});
  assert.deepEqual(store.getState().blocks[0].blocks[0],table);await store.close();
});
