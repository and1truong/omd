import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from './store-helper.js';
import { emptyNotebook, STORAGE_KEY } from '../src/model.ts';
import { parseBook, wrapPage, listPages } from '../src/notebook.ts';
import { startReminders } from '../src/reminders.ts';
const memory = () => { const m = new Map(); return { getItem:k=>m.get(k)??null, setItem:(k,v)=>m.set(k,v) }; };
test('all imported page IDs are validated before listing the hierarchy', () => {
  for (const version of [2, 3]) for (const index of [0, 1]) for (const id of ['', null, 42, {}, []]) {
    const book = wrapPage(emptyNotebook());
    book.pages.push(emptyNotebook());
    book.pages[index].id = id;
    book.activePageId = book.pages[0].id;
    book.parents = Object.fromEntries(book.pages.map(page => [page.id, '']));
    const {parents, ...v2} = book;
    const raw = JSON.stringify(version === 2 ? {...v2, version} : book);
    assert.throws(() => parseBook(raw), /Notebook ID must be (nonempty )?text/);
  }
  assert.throws(() => wrapPage({...emptyNotebook(), id: ''}), /nonempty/);
  const book = wrapPage({...emptyNotebook(), id: 'p:á/"一'});
  const child = {...emptyNotebook(), id: '__proto__'};
  book.pages.push(child); book.parents[child.id] = book.pages[0].id;
  assert.deepEqual(listPages(parseBook(JSON.stringify(book))).map(row => [row.pageId, row.depth]), [[book.pages[0].id, 0], [child.id, 1]]);
});

test('v1 migration preserves page IDs, content, settings and original bytes', async () => {
  const data=memory(), legacy=emptyNotebook(); legacy.title='Existing work'; legacy.theme='dark';
  const raw=JSON.stringify(legacy); data.setItem(STORAGE_KEY,raw);
  const store=(await createStore(data)); assert.equal(store.getState().id,legacy.id); assert.equal(store.getState().title,'Existing work'); assert.equal(store.getState().theme,'dark');
  assert.equal(data.getItem(`${STORAGE_KEY}.v1-backup`),raw);
  assert.equal(data.getItem(STORAGE_KEY),raw);
  assert.equal((await (await createStore(data)).getNotebook()).id,(await store.getNotebook()).id);
});
test('failed migration never replaces the original saved page', async () => {
  const data=memory(),raw=JSON.stringify(emptyNotebook()); data.setItem(STORAGE_KEY,raw);
  const set=data.setItem; data.setItem=(k,v)=>{if(k.endsWith('backup'))throw new Error('quota');set(k,v);};
  await assert.rejects(async () => (await createStore(data)),/quota/); assert.equal(data.getItem(STORAGE_KEY),raw);
});
test('pages create/switch/rename/reorder with isolated blocks and retained navigation after undo', async () => {
  const store=(await createStore(memory(),{initial:emptyNotebook})),first=store.getState().id;
  (await store.dispatch('add_block',{type:'text',text:'First page'}));
  const second=(await store.dispatch('page_add',{title:'Second'})).pageId;
  (await store.dispatch('add_block',{type:'text',text:'Second page'}));
  (await store.dispatch('page_select',{pageId:first}));
  assert.equal(store.getState().blocks[0].text,'First page');
  (await store.dispatch('page_update',{pageId:second,title:'Renamed'})); assert.equal((await store.getPage(second)).title,'Renamed');
  (await store.dispatch('page_move',{pageId:second,index:0})); assert.equal(store.listPages()[0].pageId,second);
  (await store.undo()); assert.equal(store.getState().id,first); assert.equal(store.listPages()[0].pageId,first);
  (await store.redo()); assert.equal(store.listPages()[0].pageId,second);
  (await store.dispatch('update_block',{pageId:second,blockId:(await store.getPage(second)).blocks[0].id,patch:{text:'Edited while hidden'}}));
  assert.equal(store.getState().blocks[0].text,'First page'); assert.equal((await store.getPage(second)).blocks[0].text,'Edited while hidden');
});
test('full notebook import/export retains order, selection and all page contents, accepting v1 exports', async () => {
  const data=memory(),store=(await createStore(data,{initial:emptyNotebook})); const a=store.getState().id;
  const b=(await store.dispatch('page_add',{title:'Other'})).pageId; (await store.dispatch('page_move',{pageId:b,index:0}));(await store.dispatch('page_select',{pageId:a}));
  const exported=(await store.export());assert.equal(parseBook(exported).pages.length,2);
  const restored=(await createStore(memory()));(await restored.import(exported));assert.deepEqual(restored.listPages(),store.listPages());
  assert.equal((await createStore(data)).getState().id,a);
  (await restored.import(JSON.stringify(emptyNotebook())));assert.equal(restored.listPages().length,1);
});
test('invalid page actions and imports are atomic; final page cannot be deleted', async () => {
  const store=(await createStore(memory(),{initial:emptyNotebook})),before=(await store.export());
  await assert.rejects(async () => (await store.dispatch('page_remove',{pageId:store.getState().id})),/at least one/);
  await assert.rejects(async () => (await store.dispatch('page_select',{pageId:'missing'})),/not found/);
  await assert.rejects(async () => (await store.dispatch('page_move',{pageId:store.getState().id,index:5})),/position/);
  const invalid=JSON.parse(before);invalid.pages.push(structuredClone(invalid.pages[0]));await assert.rejects(async () => (await store.import(JSON.stringify(invalid))),/unique/);
  assert.equal((await store.export()),before);
});
test('reminders in a different notebook page deliver without switching the active page', async () => {
  const store=(await createStore(memory(),{initial:emptyNotebook})),a=store.getState().id;
  const b=(await store.dispatch('page_add',{title:'Reminders'})).pageId;
  (await store.dispatch('add_block',{type:'reminder',dueAt:'2020-01-01T00:00:00Z'}));(await store.dispatch('page_select',{pageId:a}));
  let delivered;const runner=startReminders(store,{timers:{setInterval:()=>1,clearInterval(){}},deliver:r=>{delivered=r;}});
  await runner.tick();runner.stop();assert.equal(delivered.pageId,b);assert.equal(store.getState().id,a);assert.ok((await store.getPage(b)).blocks[0].firedAt);
});
