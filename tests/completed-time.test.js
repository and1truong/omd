import test from 'node:test';
import assert from 'node:assert/strict';
import {completedDate} from '../src/completed-time.ts';
import {emptyNotebook,applyAction,parseImport} from '../src/model.ts';
import {createStore,failWrites} from './store-helper.js';

test('missing or non-ISO completion times never become epoch dates',()=>{
  for(const value of [undefined,null,'',0,false,'0','1970','not a date','2026-10-13','2026-10-13T14:15','2026-99-99T14:15:00Z'])assert.equal(completedDate(value),null);
  assert.equal(completedDate('2026-10-13T14:15:16+07:00').toISOString(),'2026-10-13T07:15:16.000Z');
  assert.equal(completedDate('1970-01-01T00:00:00Z').toISOString(),'1970-01-01T00:00:00.000Z','An explicit historical date remains valid.');
});

test('completion time follows checked transitions and never backfills legacy checked items',()=>{
  let page=emptyNotebook();page=applyAction(page,'add_block',{type:'checklist'}).state;
  const blockId=page.blocks[0].id;page=applyAction(page,'checklist_add',{blockId,text:'Task'}).state;const itemId=page.blocks[0].items[0].id;
  const update=patch=>{page=applyAction(page,'checklist_update',{blockId,itemId,patch}).state;return page.blocks[0].items[0];};
  assert.equal(Object.hasOwn(page.blocks[0].items[0],'completedAt'),false);
  const before=Date.now(),stamp=update({done:true}).completedAt;assert.ok(Date.parse(stamp)>=before&&Date.parse(stamp)<=Date.now());
  assert.equal(update({text:'Edited'}).completedAt,stamp);assert.equal(update({done:true}).completedAt,stamp);
  assert.equal(Object.hasOwn(update({done:false}),'completedAt'),false);
  page.blocks[0].items[0]={id:itemId,text:'Old checked task',done:true};assert.equal(Object.hasOwn(update({done:true}),'completedAt'),false);assert.equal(Object.hasOwn(update({text:'Still no date'}),'completedAt'),false);
  for(const missing of [undefined,null,'']){const legacy=structuredClone(page);if(missing!==undefined)legacy.blocks[0].items[0].completedAt=missing;assert.deepEqual(parseImport(JSON.stringify(legacy)),legacy);}
  for(const invalid of [0,false,'0','bad','2026-10-13']){const legacy=structuredClone(page);legacy.blocks[0].items[0].completedAt=invalid;assert.throws(()=>parseImport(JSON.stringify(legacy)),/Completion date/);}
});

test('completion timestamps survive nested record persistence, history, moves and JSON; failed writes are atomic',async()=>{
  const storage={getItem:()=>null,setItem:()=>{}};let store=await createStore(storage,{initial:emptyNotebook});
  const blockId=(await store.dispatch('add_block',{type:'checklist'})).blockId,parent=(await store.dispatch('checklist_add',{blockId,text:'Parent'})).itemId;
  const itemId=(await store.dispatch('checklist_add',{blockId,text:'Child',parentId:parent})).itemId;
  const child=()=>store.getState().blocks[0].items[0].children[0];
  const restore=failWrites(store);await assert.rejects(()=>store.dispatch('checklist_update',{blockId,itemId,patch:{done:true}}),/quota/);restore();assert.equal(child().done,false);assert.equal(child().completedAt,undefined);
  await store.dispatch('checklist_update',{blockId,itemId,patch:{done:true}});const stamp=child().completedAt;assert.ok(completedDate(stamp));
  await store.undo();assert.equal(child().done,false);assert.equal(child().completedAt,undefined);await store.redo();assert.equal(child().completedAt,stamp);
  await store.dispatch('checklist_update',{blockId,itemId,patch:{done:false}});assert.equal(child().completedAt,undefined);await store.undo();assert.equal(child().completedAt,stamp);
  await store.dispatch('checklist_move',{blockId,itemId,parentId:'',index:1});assert.equal(store.getState().blocks[0].items[1].completedAt,stamp);await store.undo();assert.equal(child().completedAt,stamp);
  const exported=await store.export();await store.close();store=await createStore(storage);assert.equal(child().completedAt,stamp);await store.import(exported);assert.equal(child().completedAt,stamp);
  await store.dispatch('checklist_update',{blockId,itemId,patch:{done:false}});await new Promise(resolve=>setTimeout(resolve,5));await store.dispatch('checklist_update',{blockId,itemId,patch:{done:true}});assert.notEqual(child().completedAt,stamp);
  await store.close();
});
