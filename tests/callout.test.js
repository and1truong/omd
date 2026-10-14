import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyNotebook,makeBlock,applyAction,validateNotebook,parseImport,allowedTypes} from '../src/model.ts';
import {createStore,failWrites} from './store-helper.js';

test('callouts validate content, icons and tones at the command/import boundary',()=>{
  const defaults=makeBlock('callout');assert.equal(defaults.icon,'💡');assert.equal(defaults.tone,'neutral');assert.equal(defaults.text,'');
  const page=emptyNotebook();page.blocks=[defaults];validateNotebook(page);
  for(const patch of [{tone:'unknown'},{icon:42},{icon:'x'.repeat(33)},{icon:'a\nb'},{text:null},{title:'wrong field'}]) {
    assert.throws(()=>applyAction(page,'update_block',{blockId:defaults.id,patch}));
    assert.throws(()=>parseImport(JSON.stringify({...page,blocks:[{...defaults,...patch}]})));
  }
  assert.deepEqual(parseImport(JSON.stringify(page)),page);
  assert.ok(allowedTypes(page,'page').types.includes('callout'));
});

test('nested callouts persist, export/import and participate in undo/redo atomically',async()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  let store=await createStore(storage);
  await store.dispatch('page_add',{title:'Callout storage'});
  const parent=(await store.dispatch('add_block',{type:'toggle'})).block;
  const callout=(await store.dispatch('add_block',{type:'callout',containerId:parent.id,text:'**Remember**',icon:'📌',tone:'info'})).block;
  const patch={text:'Keep *this*',icon:'⚠️',tone:'warning'};
  await store.dispatch('update_block',{blockId:callout.id,patch});await store.undo();
  assert.deepEqual(store.getState().blocks[0].blocks[0],callout);await store.redo();
  const expected={...callout,...patch};assert.deepEqual(store.getState().blocks[0].blocks[0],expected);
  const restore=failWrites(store);try{await assert.rejects(store.dispatch('update_block',{blockId:callout.id,patch:{tone:'danger'}}));}finally{restore();}
  assert.deepEqual(store.getState().blocks[0].blocks[0],expected);
  const raw=await store.export(),activePageId=store.getActivePageId();await store.close();store=await createStore(storage,{activePageId});
  assert.deepEqual(store.getState().blocks[0].blocks[0],expected);await store.import(raw);
  assert.deepEqual(store.getState().blocks[0].blocks[0],expected);await store.close();
});
