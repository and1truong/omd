import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from './store-helper.js';
import {emptyNotebook,makeBlock,validateNotebook,applyAction,parseImport,STORAGE_KEY} from '../src/model.ts';
import {wrapPage} from '../src/notebook.ts';
import {createTools} from '../src/webmcp.ts';
import {diagramKey} from '../src/diagrams.ts';
import {createCompositionGuard} from '../src/composition.ts';
const memory=()=>{const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};};
test('subscribers receive immutable snapshots and current undo/redo availability',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),seen=[];let retained;
  store.subscribe(state=>{retained??=state;assert.throws(()=>{state.title='poison';},TypeError);seen.push([store.canUndo(),store.canRedo()]);});
  await store.dispatch('set_page',{title:'saved'});await store.undo();await store.redo();assert.deepEqual(seen,[[true,false],[false,true],[true,false]]);assert.equal(retained.title,'saved');assert.equal((await store.getNotebook()).pages[0].title,'saved');await store.close();
});
test('root container alias cannot collide with imported toggle, tab or accordion containers',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),before=await store.export();
  for(const type of ['toggle','tabs','accordion']){const page=emptyNotebook(),block=makeBlock(type);if(type==='toggle')block.id='page';if(type==='tabs'){block.tabs[0].id='page';block.activeTabId='page';}if(type==='accordion')block.items[0].id='page';page.blocks=[block];
    assert.throws(()=>validateNotebook(page),/reserved/);await assert.rejects(async()=>store.import(JSON.stringify(page)),/reserved/);assert.equal(await store.export(),before);
  }
  await store.close();
});
test('legacy Date.parse strings migrate in v1, v2 and v3 data while preserving original saved bytes',async()=>{
  for(const version of [1,2,3]){const page=emptyNotebook();page.updatedAt='2026-10-12 16:00:00Z';const reminder=makeBlock('reminder',{dueAt:'2020-01-01 16:00:00Z'});reminder.firedAt='2020-01-01 16:05:00Z';page.blocks=[reminder];
    let value=page;if(version!==1){value=wrapPage(emptyNotebook());value.pages=[page];value.activePageId=page.id;value.parents={[page.id]:''};if(version===2){value.version=2;delete value.parents;}}
    const data=memory(),raw=JSON.stringify(value);data.setItem(STORAGE_KEY,raw);const store=await createStore(data);assert.equal(store.getState().updatedAt,'2026-10-12T16:00:00.000Z');assert.equal(store.getState().blocks[0].dueAt,'2020-01-01T16:00:00.000Z');assert.equal(store.getState().blocks[0].firedAt,'2020-01-01T16:05:00.000Z');assert.equal(data.getItem(STORAGE_KEY),raw);await store.close();
  }
  const page=emptyNotebook();assert.throws(()=>applyAction(page,'add_block',{type:'reminder',dueAt:'2026-10-12 16:00:00Z'}),/timezone/);assert.throws(()=>parseImport(JSON.stringify({...page,updatedAt:'not a date'})),/Updated date/);
});
test('page-tree read and history tools consistently report the persisted notebook revision',async()=>{
  const store=await createStore(memory(),{initial:emptyNotebook}),tools=createTools(store),call=(name,args={})=>tools.find(t=>t.name===`omd_${name}`).execute(args),first=store.getActivePageId();
  const child=await call('page_add',{parentId:first});assert.equal((await call('get_notebook')).revision,child.revision);assert.equal((await call('get_page',{pageId:first})).revision,child.revision);assert.equal((await call('get_notebook')).pageRevision,0);
  for(const [name,args] of [['page_select',{pageId:first}],['page_move',{pageId:child.pageId,parentId:''}],['undo',{}],['redo',{}]]){const result=await call(name,args);assert.equal(result.revision,store.getRevision());assert.equal((await call('get_notebook')).revision,result.revision);}
  for(const name of ['list_pages','get_page','page_add','page_select','page_update','page_move','page_remove','get_view','set_view'])assert.ok(tools.some(t=>t.name===`omd_${name}`));assert.ok(Object.hasOwn(tools.find(t=>t.name==='omd_page_add').inputSchema.properties,'parentId'));assert.ok(Object.hasOwn(tools.find(t=>t.name==='omd_set_view').inputSchema.properties,'collapsedPageIds'));await store.close();
});
test('diagram keys are collision-free even with separators and selector characters in imported IDs',()=>{
  assert.notEqual(diagramKey('a:b','c'),diagramKey('a','b:c'));assert.notEqual(diagramKey('a','quote"\\canvas'),diagramKey('a:quote','"\\canvas'));assert.deepEqual(JSON.parse(diagramKey('a:b','c')),['a:b','c']);
});
test('composition holds render deferral through final persistence and retains its original page target',async()=>{
  const input=new EventTarget();let pageId='original',release,writes=[],settled=0;
  const guard=createCompositionGuard({onSettled:()=>settled++});guard.track(input,async origin=>{writes.push(origin);await new Promise(resolve=>{release=resolve;});},()=>pageId);
  input.dispatchEvent(new Event('compositionstart'));pageId='other';input.dispatchEvent(new Event('compositionend'));await Promise.resolve();assert.deepEqual(writes,['original']);assert.equal(guard.isComposing(input),true);assert.equal(settled,0);release();await new Promise(resolve=>setImmediate(resolve));assert.equal(guard.hasActive(),false);assert.equal(settled,1);
});
test('superseded composition generations stay in scoped barriers until their final writes finish',async()=>{
  const guard=createCompositionGuard(),input=new EventTarget(),other=new EventTarget();let release,started,firstCurrent,settlements=0;
  const began=new Promise(resolve=>started=resolve),pending=new Promise(resolve=>release=resolve);let writes=0;
  guard.track(input,async(_pageId,{isCurrent})=>{if(++writes===1){firstCurrent=isCurrent;started();await pending;}},()=> 'page');
  guard.track(other,()=>{},()=> 'other');input.dispatchEvent(new Event('compositionstart'));assert.equal(guard.isPreediting(input),true);
  input.dispatchEvent(new Event('compositionend'));await began;assert.equal(guard.isPreediting(input),false);assert.equal(firstCurrent(),true);
  const waiting=guard.settled(target=>target===input).then(()=>settlements++);
  input.dispatchEvent(new Event('compositionstart'));assert.equal(firstCurrent(),false);assert.equal(guard.isPreediting(input),true);
  input.dispatchEvent(new Event('compositionend'));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(guard.isPreediting(input),false);assert.equal(guard.isComposing(input),true);assert.equal(settlements,0);
  other.dispatchEvent(new Event('compositionstart'));release();await waiting;assert.equal(guard.isComposing(input),false);assert.equal(guard.isPreediting(other),true);
  other.dispatchEvent(new Event('compositionend'));await guard.settled();assert.equal(guard.hasActive(),false);
});
