import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from './store-helper.js';
import {emptyNotebook,STORAGE_KEY} from '../src/model.ts';
import {wrapPage,validateBook,parseBook,listPages,applyBookAction,MAX_PAGE_LEVELS} from '../src/notebook.ts';
import {createTools} from '../src/webmcp.ts';
const memory=()=>{const map=new Map();return {getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};};
const setup=async()=>(await createStore(memory(),{initial:emptyNotebook}));
test('nested pages have sibling ordering, depth, counts and persistent parent links',async () =>{
  const store=(await setup()),a=store.getState().id,b=(await store.dispatch('page_add',{title:'B'})).pageId;
  const child=(await store.dispatch('page_add',{title:'Child',parentId:a})).pageId,grandchild=(await store.dispatch('page_add',{title:'Grandchild',parentId:child})).pageId;
  const sibling=(await store.dispatch('page_add',{title:'First child',parentId:a,index:0})).pageId;
  const rows=store.listPages();assert.deepEqual(rows.map(p=>[p.pageId,p.depth,p.index]),[[a,0,0],[sibling,1,0],[child,1,1],[grandchild,2,0],[b,0,1]]);
  assert.equal(rows[0].descendantCount,3);assert.equal(rows[2].childCount,1);assert.equal(rows[1].siblingCount,2);
  const restored=(await setup());(await restored.import((await store.export())));assert.deepEqual(restored.listPages(),rows);assert.equal((await restored.getNotebook()).parents[grandchild],child);
});
test('reparenting moves whole subtrees, validates cycles atomically and supports undo/redo',async () =>{
  const store=(await setup()),a=store.getState().id,b=(await store.dispatch('page_add',{title:'B'})).pageId;
  const child=(await store.dispatch('page_add',{parentId:a})).pageId,grandchild=(await store.dispatch('page_add',{parentId:child})).pageId;
  const before=(await store.export());for(const input of [{pageId:a,parentId:grandchild},{pageId:a,parentId:a},{pageId:child,parentId:'missing'},{pageId:child,parentId:b,index:3}])await assert.rejects(async () => (await store.dispatch('page_move',input)));assert.equal((await store.export()),before);
  (await store.dispatch('page_move',{pageId:child,parentId:b,index:0}));assert.equal((await store.getNotebook()).parents[grandchild],child);assert.equal(store.listPages().find(p=>p.pageId===child).parentId,b);
  (await store.undo());assert.equal((await store.getNotebook()).parents[child],a);(await store.redo());assert.equal((await store.getNotebook()).parents[child],b);
  (await store.dispatch('page_move',{pageId:child,parentId:'',index:0}));assert.equal(store.listPages()[0].pageId,child);assert.equal(store.listPages()[1].pageId,grandchild);
});
test('subtree deletion selects a surviving parent, removes links and restores content with undo',async () =>{
  const store=(await setup()),root=store.getState().id,child=(await store.dispatch('page_add',{parentId:root})).pageId;
  const leaf=(await store.dispatch('page_add',{parentId:child})).pageId;(await store.dispatch('add_block',{type:'text',text:'Keep in undo'}));
  const before=(await store.export());await assert.rejects(async () => (await store.dispatch('page_remove',{pageId:root})),/at least one/);assert.equal((await store.export()),before);
  const removed=(await store.dispatch('page_remove',{pageId:child}));assert.equal(removed.removedPageIds.length,2);assert.equal(store.getState().id,root);assert.equal(store.listPages().length,1);assert.equal(Object.keys((await store.getNotebook()).parents).length,1);
  (await store.undo());assert.equal((await store.getPage(leaf)).blocks[0].text,'Keep in undo');assert.equal((await store.getNotebook()).parents[leaf],child);
});
test('v2 migration preserves original bytes and page order, including failure recovery',async () =>{
  const book=await (await setup()).getNotebook();delete book.parents;book.version=2;const raw=JSON.stringify(book),saved=memory();saved.setItem(STORAGE_KEY,raw);
  const store=(await createStore(saved));assert.equal((await store.getNotebook()).version,3);assert.equal(store.listPages()[0].parentId,'');assert.equal(saved.getItem(`${STORAGE_KEY}.v2-backup`),raw);
  assert.deepEqual(parseBook(raw).pages,book.pages);
  const failed=memory();failed.setItem(STORAGE_KEY,raw);const set=failed.setItem;failed.setItem=(k,v)=>{if(k.endsWith('backup'))throw new Error('quota');set(k,v);};await assert.rejects(async () => (await createStore(failed)),/quota/);assert.equal(failed.getItem(STORAGE_KEY),raw);
});
test('malformed hierarchy imports reject cycles, orphans and missing links without changing data',async () =>{
  const store=(await setup()),a=store.getState().id,b=(await store.dispatch('page_add',{})).pageId,before=(await store.export());
  for(const parents of [{[a]:b,[b]:a},{[a]:'missing',[b]:''},{[a]:''},{[a]:'',[b]:'',unknown:''}]){const invalid=JSON.parse(before);invalid.parents=parents;await assert.rejects(async () => (await store.import(JSON.stringify(invalid))));assert.equal((await store.export()),before);}
});
test('page trees accept 32 levels and reject level 33 on creation and import atomically',async () =>{
  const page=emptyNotebook(),book=wrapPage(page),count=MAX_PAGE_LEVELS;
  book.pages=Array.from({length:count},(_,i)=>({...page,id:`level-${i}`}));book.parents=Object.fromEntries(book.pages.map((p,i)=>[p.id,i?book.pages[i-1].id:'']));book.activePageId=book.pages.at(-1).id;
  validateBook(book);const rows=listPages(book);assert.equal(rows.at(-1).depth,31);assert.equal(rows[0].descendantCount,31);
  const store=(await setup());(await store.import(JSON.stringify(book)));const before=(await store.export());
  await assert.rejects(async () => (await store.dispatch('page_add',{parentId:book.activePageId})),/32 levels/);assert.equal((await store.export()),before);
  book.pages.push({...page,id:'level-32'});book.parents['level-32']='level-31';await assert.rejects(async () => (await store.import(JSON.stringify(book))),/32 levels/);assert.equal((await store.export()),before);
});
test('subtree height participates in the 32-level move limit',async () =>{
  const page=emptyNotebook(),book=wrapPage(page);
  book.pages=Array.from({length:32},(_,i)=>({...page,id:`level-${i}`}));book.parents=Object.fromEntries(book.pages.map((p,i)=>[p.id,i?book.pages[i-1].id:'']));book.activePageId='level-31';
  for(let i=0;i<3;i++){book.pages.push({...page,id:`branch-${i}`});book.parents[`branch-${i}`]=i?`branch-${i-1}`:'';}validateBook(book);
  assert.throws(()=>applyBookAction(book,'page_move',{pageId:'branch-0',parentId:'level-30'}),/32 levels/);
  const moved=applyBookAction(book,'page_move',{pageId:'branch-0',parentId:'level-28'}).state;assert.equal(listPages(moved).find(p=>p.pageId==='branch-2').depth,31);
});
test('native tool contracts expose nested creation, subtree moves, deletion and array validation',async()=>{
  const store=(await setup()),tools=createTools(store),call=(name,args={})=>tools.find(t=>t.name===`omd_${name}`).execute(args),root=store.getState().id;
  const child=(await call('page_add',{parentId:root,title:'Tool child'})).pageId;assert.equal((await call('list_pages'))[1].parentId,root);
  await call('page_move',{pageId:child,parentId:''});assert.equal((await call('list_pages'))[1].depth,0);
  await assert.rejects(()=>call('set_view',{collapsedPageIds:'not an array'}),/array/);await assert.rejects(()=>call('set_view',{collapsedPageIds:[1]}),/text/);
  await call('page_remove',{pageId:child});assert.equal(store.listPages().length,1);
});
