import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { emptyNotebook, STORAGE_KEY } from '../src/model.js';
import { parseBook } from '../src/notebook.js';
import { startReminders } from '../src/reminders.js';
const memory = () => { const m = new Map(); return { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v) }; };
test('v1 migration preserves page IDs, content, settings and original bytes', () => {
  const data=memory(), legacy=emptyNotebook(); legacy.title='Existing work'; legacy.theme='dark';
  const raw=JSON.stringify(legacy); data.setItem(STORAGE_KEY,raw);
  const store=createStore(data); assert.equal(store.getState().id,legacy.id); assert.equal(store.getState().title,'Existing work'); assert.equal(store.getState().theme,'dark');
  assert.equal(data.getItem(`${STORAGE_KEY}.v1-backup`),raw);
  assert.equal(JSON.parse(data.getItem(STORAGE_KEY)).version,2);
  assert.equal(createStore(data).getNotebook().id,store.getNotebook().id);
});
test('failed migration never replaces the original saved page', () => {
  const data=memory(),raw=JSON.stringify(emptyNotebook()); data.setItem(STORAGE_KEY,raw);
  const set=data.setItem; data.setItem=(k,v)=>{if(k===STORAGE_KEY)throw new Error('quota');set(k,v);};
  assert.throws(()=>createStore(data),/original saved data is intact/); assert.equal(data.getItem(STORAGE_KEY),raw);
});
test('pages create/switch/rename/reorder with isolated blocks and retained navigation after undo', () => {
  const store=createStore(memory(),{initial:emptyNotebook}),first=store.getState().id;
  store.dispatch('add_block',{type:'text',text:'First page'});
  const second=store.dispatch('page_add',{title:'Second'}).pageId;
  store.dispatch('add_block',{type:'text',text:'Second page'});
  store.dispatch('page_select',{pageId:first});
  assert.equal(store.getState().blocks[0].text,'First page');
  store.dispatch('page_update',{pageId:second,title:'Renamed'}); assert.equal(store.getPage(second).title,'Renamed');
  store.dispatch('page_move',{pageId:second,index:0}); assert.equal(store.listPages()[0].pageId,second);
  store.undo(); assert.equal(store.getState().id,first); assert.equal(store.listPages()[0].pageId,first);
  store.redo(); assert.equal(store.listPages()[0].pageId,second);
  store.dispatch('update_block',{pageId:second,blockId:store.getPage(second).blocks[0].id,patch:{text:'Edited while hidden'}});
  assert.equal(store.getState().blocks[0].text,'First page'); assert.equal(store.getPage(second).blocks[0].text,'Edited while hidden');
});
test('full notebook import/export retains order, selection and all page contents, accepting v1 exports', () => {
  const data=memory(),store=createStore(data,{initial:emptyNotebook}); const a=store.getState().id;
  const b=store.dispatch('page_add',{title:'Other'}).pageId; store.dispatch('page_move',{pageId:b,index:0});store.dispatch('page_select',{pageId:a});
  const exported=store.export();assert.equal(parseBook(exported).pages.length,2);
  const restored=createStore(memory());restored.import(exported);assert.deepEqual(restored.listPages(),store.listPages());
  assert.equal(createStore(data).getState().id,a);
  restored.import(JSON.stringify(emptyNotebook()));assert.equal(restored.listPages().length,1);
});
test('invalid page actions and imports are atomic; final page cannot be deleted', () => {
  const store=createStore(memory(),{initial:emptyNotebook}),before=store.export();
  assert.throws(()=>store.dispatch('page_remove',{pageId:store.getState().id}),/at least one/);
  assert.throws(()=>store.dispatch('page_select',{pageId:'missing'}),/not found/);
  assert.throws(()=>store.dispatch('page_move',{pageId:store.getState().id,index:5}),/position/);
  const invalid=JSON.parse(before);invalid.pages.push(structuredClone(invalid.pages[0]));assert.throws(()=>store.import(JSON.stringify(invalid)),/unique/);
  assert.equal(store.export(),before);
});
test('reminders in a different notebook page deliver without switching the active page', async () => {
  const store=createStore(memory(),{initial:emptyNotebook}),a=store.getState().id;
  const b=store.dispatch('page_add',{title:'Reminders'}).pageId;
  store.dispatch('add_block',{type:'reminder',dueAt:'2020-01-01T00:00:00Z'});store.dispatch('page_select',{pageId:a});
  let delivered;const runner=startReminders(store,{timers:{setInterval:()=>1,clearInterval(){}},deliver:r=>{delivered=r;}});
  await runner.tick();runner.stop();assert.equal(delivered.pageId,b);assert.equal(store.getState().id,a);assert.ok(store.getPage(b).blocks[0].firedAt);
});
