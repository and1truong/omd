import test from 'node:test';
import assert from 'node:assert/strict';
import {createView,VIEW_KEY} from '../src/view.ts';
import {createStore} from './store-helper.js';
import {emptyNotebook} from '../src/model.ts';
import {createTools} from '../src/webmcp.ts';
function storage(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};}
test('view preferences persist independently of notebook data and recover from malformed UI preferences',async () =>{
  const saved=storage(),store=(await createStore(saved,{initial:emptyNotebook})),before=(await store.export()),view=createView(saved);
  view.set({sidebarOpen:false,contentWidth:'wide',collapsedPageIds:[]});assert.deepEqual(createView(saved).get(),{sidebarOpen:false,contentWidth:'wide',collapsedPageIds:[]});assert.equal((await store.export()),before);
  saved.setItem(VIEW_KEY,'{"contentWidth":"unknown"}');assert.deepEqual(createView(saved).get(),{sidebarOpen:true,contentWidth:'reading',collapsedPageIds:[]});assert.equal(await (await createStore(saved)).export(),before);
});
test('invalid or failed view writes preserve the last saved and live preferences',async () =>{
  const saved=storage(),view=createView(saved);view.set({contentWidth:'wide'});const before=saved.getItem(VIEW_KEY);
  for(const patch of [{contentWidth:'print'},{sidebarOpen:'yes'},{unknown:true}])assert.throws(()=>view.set(patch));assert.equal(saved.getItem(VIEW_KEY),before);
  saved.setItem=()=>{throw new Error('quota');};assert.throws(()=>view.set({sidebarOpen:false}),/Could not save/);assert.deepEqual(view.get(),{sidebarOpen:true,contentWidth:'wide',collapsedPageIds:[]});
});
test('WebMCP uses the same view preferences and validates before changing them',async()=>{
  const saved=storage(),view=createView(saved),store=(await createStore(saved,{initial:emptyNotebook})),tools=createTools(store,{getView:view.get,setView:view.set});const call=(name,args={})=>tools.find(t=>t.name===`omd_${name}`).execute(args);
  assert.deepEqual(await call('set_view',{contentWidth:'wide',sidebarOpen:false,collapsedPageIds:[]}),{contentWidth:'wide',sidebarOpen:false,collapsedPageIds:[]});assert.deepEqual(await call('get_view'),createView(saved).get());
  await assert.rejects(()=>call('set_view',{contentWidth:'unknown'}));await assert.rejects(()=>call('set_view',{sidebarOpen:1}));assert.equal(view.get().contentWidth,'wide');
});
