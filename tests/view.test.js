import test from 'node:test';
import assert from 'node:assert/strict';
import {createView,VIEW_KEY} from '../src/view.ts';
import {createStore} from './store-helper.js';
import {emptyNotebook} from '../src/model.ts';
import {createTools} from '../src/webmcp.ts';
function storage(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};}
test('view preferences persist independently of notebook data and recover from malformed UI preferences',async () =>{
  const saved=storage(),store=(await createStore(saved,{initial:emptyNotebook})),before=(await store.export()),view=createView(saved);
  view.set({sidebarOpen:false,contentWidth:'wide',collapsedPageIds:[]});assert.deepEqual(createView(saved).get(),{sidebarOpen:false,contentWidth:'wide',collapsedPageIds:[],theme:'system'});assert.equal((await store.export()),before);
  saved.setItem(VIEW_KEY,'{"contentWidth":"unknown"}');assert.deepEqual(createView(saved).get(),{sidebarOpen:true,contentWidth:'reading',collapsedPageIds:[],theme:'system'});assert.equal(await (await createStore(saved)).export(),before);
});
test('invalid or failed view writes preserve the last saved and live preferences',async () =>{
  const saved=storage(),view=createView(saved);view.set({contentWidth:'wide'});const before=saved.getItem(VIEW_KEY);
  for(const patch of [{contentWidth:'print'},{sidebarOpen:'yes'},{unknown:true},{theme:'sepia'},{theme:null},{theme:0}])assert.throws(()=>view.set(patch));assert.equal(saved.getItem(VIEW_KEY),before);
  saved.setItem=()=>{throw new Error('quota');};assert.throws(()=>view.set({theme:'dark'}),/Could not save/);assert.deepEqual(view.get(),{sidebarOpen:true,contentWidth:'wide',collapsedPageIds:[],theme:'system'});
});
test('WebMCP uses the same view preferences and validates before changing them',async()=>{
  const saved=storage(),view=createView(saved),store=(await createStore(saved,{initial:emptyNotebook})),tools=createTools(store,{getView:view.get,setView:view.set});const call=(name,args={})=>tools.find(t=>t.name===`omd_${name}`).execute(args);
  assert.deepEqual(await call('set_view',{contentWidth:'wide',sidebarOpen:false,collapsedPageIds:[]}),{contentWidth:'wide',sidebarOpen:false,collapsedPageIds:[],theme:'system'});assert.deepEqual(await call('get_view'),createView(saved).get());
  await assert.rejects(()=>call('set_view',{contentWidth:'unknown'}));await assert.rejects(()=>call('set_view',{sidebarOpen:1}));assert.equal(view.get().contentWidth,'wide');
});
test('legacy theme migrates once without changing other preferences or notebook data',async()=>{
  const saved=storage(),store=await createStore(saved,{initial:emptyNotebook});await store.dispatch('set_page',{theme:'dark'});
  const before=await store.export();saved.setItem(VIEW_KEY,JSON.stringify({contentWidth:'wide',sidebarOpen:false,collapsedPageIds:[]}));
  const view=createView(saved,store.getState().theme);assert.equal(view.get().theme,'dark');assert.equal(view.get().contentWidth,'wide');assert.equal(await store.export(),before);
  assert.equal(createView(saved,'light').get().theme,'dark');view.set({theme:'system'});assert.equal(createView(saved,'dark').get().theme,'system');
  await store.close();
});
test('malformed or inaccessible preferences safely default to system; failed migration is nonfatal',()=>{
  for(const raw of ['{','null','{"theme":"sepia"}','{"theme":"dark","sidebarOpen":1}']){const saved=storage();saved.setItem(VIEW_KEY,raw);assert.equal(createView(saved,'dark').get().theme,'system');}
  assert.equal(createView({getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}},'dark').get().theme,'system');
  const saved=storage();saved.setItem=()=>{throw new Error('quota');};assert.equal(createView(saved,'dark').get().theme,'dark');
});
test('remote theme refresh never imports sidebar state; unrelated writes do not overwrite remote theme',()=>{
  const saved=storage(),a=createView(saved),b=createView(saved);a.set({sidebarOpen:false,theme:'dark'});
  assert.equal(b.refreshTheme(),'dark');assert.equal(b.get().sidebarOpen,true);
  a.set({theme:'light'});b.set({contentWidth:'wide'});assert.equal(createView(saved).get().theme,'light');assert.equal(createView(saved).get().sidebarOpen,false);
  saved.map.delete(VIEW_KEY);assert.equal(b.refreshTheme(),'system');saved.setItem(VIEW_KEY,'{"theme":"broken"}');assert.equal(a.refreshTheme(),'system');
});
test('WebMCP theme alias changes only global preference and rejects invalid or failed changes',async()=>{
  const saved=storage(),view=createView(saved),store=await createStore(saved,{initial:emptyNotebook}),tools=createTools(store,{getView:view.get,setView:view.set});
  const call=(name,input={})=>tools.find(t=>t.name===`omd_${name}`).execute(input),before=await store.export(),revision=store.getRevision();
  assert.equal(tools.length,55);await call('set_page',{theme:'dark'});assert.equal(view.get().theme,'dark');assert.equal(await store.export(),before);assert.equal(store.getRevision(),revision);assert.equal(store.canUndo(),false);
  await call('set_view',{theme:'light'});assert.equal((await call('get_view')).theme,'light');assert.equal(await store.export(),before);
  await assert.rejects(()=>call('set_page',{theme:'system',pageId:'missing'}));assert.equal(view.get().theme,'light');
  for(const input of [{theme:'sepia'},{theme:42},{theme:null}]){await assert.rejects(()=>call('set_view',input));await assert.rejects(()=>call('set_page',input));}
  saved.setItem=()=>{throw new Error('quota');};await assert.rejects(()=>call('set_page',{theme:'dark',title:'Do not save'}),/Could not save/);assert.equal(await store.export(),before);assert.equal(view.get().theme,'light');
  saved.setItem=(k,v)=>saved.map.set(k,v);await call('set_page',{theme:'dark',title:'Content still works'});assert.equal(store.getState().title,'Content still works');assert.equal(store.getState().theme,'system');await store.undo();assert.equal(view.get().theme,'dark');await store.close();
});
