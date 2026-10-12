import test from 'node:test';
import assert from 'node:assert/strict';
import {createView,VIEW_KEY} from '../src/view.js';
import {createStore} from '../src/store.js';
import {emptyNotebook} from '../src/model.js';
import {createTools} from '../src/webmcp.js';
function storage(){const map=new Map();return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};}
test('view preferences persist independently of notebook data and recover from malformed UI preferences',()=>{
  const saved=storage(),store=createStore(saved,{initial:emptyNotebook}),before=store.export(),view=createView(saved);
  view.set({sidebarOpen:false,contentWidth:'wide'});assert.deepEqual(createView(saved).get(),{sidebarOpen:false,contentWidth:'wide'});assert.equal(store.export(),before);
  saved.setItem(VIEW_KEY,'{"contentWidth":"unknown"}');assert.deepEqual(createView(saved).get(),{sidebarOpen:true,contentWidth:'reading'});assert.equal(createStore(saved).export(),before);
});
test('invalid or failed view writes preserve the last saved and live preferences',()=>{
  const saved=storage(),view=createView(saved);view.set({contentWidth:'wide'});const before=saved.getItem(VIEW_KEY);
  for(const patch of [{contentWidth:'print'},{sidebarOpen:'yes'},{unknown:true}])assert.throws(()=>view.set(patch));assert.equal(saved.getItem(VIEW_KEY),before);
  saved.setItem=()=>{throw new Error('quota');};assert.throws(()=>view.set({sidebarOpen:false}),/Could not save/);assert.deepEqual(view.get(),{sidebarOpen:true,contentWidth:'wide'});
});
test('WebMCP uses the same view preferences and validates before changing them',async()=>{
  const saved=storage(),view=createView(saved),store=createStore(saved,{initial:emptyNotebook}),tools=createTools(store,{getView:view.get,setView:view.set});const call=(name,args={})=>tools.find(t=>t.name===`omd_${name}`).execute(args);
  assert.deepEqual(await call('set_view',{contentWidth:'wide',sidebarOpen:false}),{contentWidth:'wide',sidebarOpen:false});assert.deepEqual(await call('get_view'),createView(saved).get());
  await assert.rejects(()=>call('set_view',{contentWidth:'unknown'}));await assert.rejects(()=>call('set_view',{sidebarOpen:1}));assert.equal(view.get().contentWidth,'wide');
});
