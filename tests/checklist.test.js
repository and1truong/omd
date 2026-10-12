import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyNotebook,applyAction,parseImport,findChecklistItem} from '../src/model.ts';
import {parseBook} from '../src/notebook.ts';
import {createStore} from './store-helper.js';

function fixture() {
  let page=emptyNotebook();
  const act=(name,input)=>{const out=applyAction(page,name,input);page=out.state;return out.result;};
  const blockId=act('add_block',{type:'checklist'}).blockId;
  return {act,blockId,get page(){return page;},get items(){return page.blocks[0].items;},
    add(text,parentId,index){return act('checklist_add',{blockId,text,parentId,index}).itemId;}};
}

test('nested checklist CRUD addresses any depth and reorders or moves entire branches',()=>{
  const f=fixture(),a=f.add('A'),b=f.add('B'),child=f.add('Child',a),other=f.add('Other',a),grandchild=f.add('Grandchild',child);
  f.act('checklist_update',{blockId:f.blockId,itemId:grandchild,patch:{text:'Updated',done:true}});
  assert.equal(findChecklistItem(f.items,grandchild).item.text,'Updated');assert.equal(f.items[0].done,false);
  f.act('checklist_move',{blockId:f.blockId,itemId:other,index:0});
  assert.deepEqual(f.items[0].children.map(i=>i.id),[other,child]);
  f.act('checklist_move',{blockId:f.blockId,itemId:child,parentId:b,index:0});
  assert.equal(f.items[1].children[0].children[0].id,grandchild);
  f.act('checklist_move',{blockId:f.blockId,itemId:child,parentId:'',index:1});
  assert.deepEqual(f.items.map(i=>i.id),[a,child,b]);assert.equal(f.items[1].children[0].done,true);
  f.act('checklist_remove',{blockId:f.blockId,itemId:grandchild});assert.deepEqual(f.items[1].children,[]);
  f.act('checklist_remove',{blockId:f.blockId,itemId:a});assert.throws(()=>findChecklistItem(f.items,other),/not found/);
});

test('four levels include root items; overdeep additions, subtree moves and cycles fail atomically',()=>{
  const f=fixture(),root=f.add('Root'),child=f.add('Child',root),grandchild=f.add('Grandchild',child),leaf=f.add('Leaf',grandchild),branch=f.add('Branch'),branchChild=f.add('Branch child',branch);
  assert.equal(findChecklistItem(f.items,leaf).ancestors.length,3);
  const otherBlock=f.act('add_block',{type:'checklist'}).blockId;
  const foreign=f.act('checklist_add',{blockId:otherBlock,text:'Foreign'}).itemId;
  for(const [name,input,pattern] of [
    ['checklist_add',{parentId:leaf},/4 levels/],
    ['checklist_move',{itemId:branch,parentId:grandchild,index:0},/4 levels/],
    ['checklist_move',{itemId:root,parentId:root,index:0},/itself/],
    ['checklist_move',{itemId:root,parentId:leaf,index:0},/descendants/],
    ['checklist_move',{itemId:leaf,parentId:'missing',index:0},/not found/],
    ['checklist_add',{parentId:foreign},/not found/],
    ['checklist_move',{itemId:branchChild,index:1},/position/],
    ['checklist_move',{itemId:leaf,parentId:'',index:-1},/position/]
  ]) {
    const before=structuredClone(f.page);
    assert.throws(()=>f.act(name,{blockId:f.blockId,...input}),pattern);assert.deepEqual(f.page,before);
  }
  // A leaf can move to level 4, and a two-level branch can move to level 3.
  f.act('checklist_move',{blockId:f.blockId,itemId:branch,parentId:child,index:0});
  assert.equal(findChecklistItem(f.items,branchChild).ancestors.length,3);
});

test('imports preserve legacy flat items, validate all descendants and reject malformed nested data',()=>{
  const f=fixture(),root=f.add('Root');
  assert.deepEqual(parseImport(JSON.stringify(f.page)).blocks[0].items,[{id:root,text:'Root',done:false}]);
  const child=f.add('Child',root),grandchild=f.add('Grandchild',child),leaf=f.add('Leaf',grandchild);
  assert.deepEqual(parseImport(JSON.stringify(f.page)),f.page);
  for(const [mutate,pattern] of [
    [page=>findChecklistItem(page.blocks[0].items,leaf).item.children=[{id:'extra',text:'Too deep',done:false}],/4 levels/],
    [page=>findChecklistItem(page.blocks[0].items,child).item.id=root,/unique/],
    [page=>findChecklistItem(page.blocks[0].items,leaf).item.done='yes',/true or false/],
    [page=>findChecklistItem(page.blocks[0].items,child).item.children=null,/list/],
    [page=>findChecklistItem(page.blocks[0].items,child).item.extra=true,/Unknown field/]
  ]) {
    const page=structuredClone(f.page);mutate(page);assert.throws(()=>parseImport(JSON.stringify(page)),pattern);
  }
});

test('nested checklist persistence, exports and undo/redo preserve subtrees and independent checkbox states',async()=>{
  const storage={getItem:()=>null,setItem:()=>{}},store=await createStore(storage,{initial:emptyNotebook});
  const blockId=(await store.dispatch('add_block',{type:'checklist'})).blockId;
  const root=(await store.dispatch('checklist_add',{blockId,text:'Root'})).itemId;
  const child=(await store.dispatch('checklist_add',{blockId,parentId:root,text:'Child'})).itemId;
  await store.dispatch('checklist_update',{blockId,itemId:child,patch:{done:true}});
  await store.dispatch('checklist_move',{blockId,itemId:child,parentId:'',index:1});
  assert.equal(store.getState().blocks[0].items.length,2);
  await store.undo();assert.equal(store.getState().blocks[0].items[0].children[0].id,child);
  await store.redo();assert.equal(store.getState().blocks[0].items[1].id,child);
  await store.undo();await store.dispatch('checklist_remove',{blockId,itemId:root});
  assert.deepEqual(store.getState().blocks[0].items,[]);
  await store.undo();const expected=store.getState().blocks[0].items;
  assert.equal(expected[0].done,false);assert.equal(expected[0].children[0].done,true);
  const json=await store.export();assert.deepEqual(parseBook(json).pages[0].blocks[0].items,expected);
  const before=await store.export();
  await assert.rejects(()=>store.dispatch('checklist_move',{blockId,itemId:root,parentId:child,index:0}),/descendants/);
  assert.equal(await store.export(),before);
  await store.close();const reopened=await createStore(storage);
  assert.deepEqual(reopened.getState().blocks[0].items,expected);
  const imported=await createStore({getItem:()=>null,setItem:()=>{}},{initial:emptyNotebook});
  await imported.import(json);assert.deepEqual(imported.getState().blocks[0].items,expected);
  await reopened.close();await imported.close();
});
