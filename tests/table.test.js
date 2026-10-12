import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyNotebook,makeBlock,applyAction,validateNotebook,MAX_TABLE_CELL_LENGTH} from '../src/model.ts';
import {createStore,failWrites} from './store-helper.js';
import {createTools} from '../src/webmcp.ts';
const content=json=>JSON.parse(json,(key,value)=>['revision','updatedAt'].includes(key)?undefined:value);

test('table defaults, stable identities and positional dimension edits',()=>{
  let page=emptyNotebook();const table=makeBlock('table');page.blocks.push(table);
  const act=(name,input)=>{const out=applyAction(page,name,{blockId:table.id,...input});page=out.state;return out.result;};
  assert.equal(table.headerRow,true);assert.equal(table.rows.length,3);assert.equal(table.columns.length,3);
  const rowId=table.rows[1].id,columnId=table.columns[1].id;
  act('table_cell_update',{rowId,columnId,text:'Tiếng Việt / 日本語\n<script>'});
  const row=act('table_row_add',{index:0}).rowId,col=act('table_column_add',{index:0}).columnId;
  assert.equal(page.blocks[0].rows[2].cells[2],'Tiếng Việt / 日本語\n<script>');
  act('table_row_remove',{rowId:row});act('table_column_remove',{columnId:col});
  assert.equal(page.blocks[0].rows[1].id,rowId);assert.equal(page.blocks[0].columns[1].id,columnId);
  assert.equal(page.blocks[0].rows[1].cells[1],'Tiếng Việt / 日本語\n<script>');
  for(const input of [{rowId:'missing',columnId,text:'x'},{rowId,columnId:'missing',text:'x'},{rowId,columnId,text:42},{rowId,columnId,text:'x'.repeat(MAX_TABLE_CELL_LENGTH+1)}])assert.throws(()=>act('table_cell_update',input));
  for(const name of ['table_row_add','table_column_add'])for(const index of [-1,1.1,99,NaN,'1'])assert.throws(()=>act(name,{index}));
  assert.throws(()=>act('update_block',{patch:{rows:[]}}),/Unknown/);
});

test('model and import reject oversized, malformed, duplicate ID and non-text grids',()=>{
  for(const option of ['rowCount','columnCount'])for(const value of [0,-1,1.5,NaN,Infinity,'3',100000])assert.throws(()=>makeBlock('table',{[option]:value}));
  assert.throws(()=>makeBlock('table',{headerRow:'yes'}));
  const base=emptyNotebook();base.blocks.push(makeBlock('table'));
  for(const corrupt of [b=>b.rows=[],b=>b.columns=[],b=>b.rows[0].cells.pop(),b=>b.rows[0].cells.push('x'),b=>b.rows[0].cells[0]=false,b=>b.rows[0].cells[0]='x'.repeat(10001),b=>b.rows[0].id=b.columns[0].id,b=>b.columns[0].id='',b=>b.columns[0].id=2,b=>b.columns[0].extra=true,b=>b.rows=Array.from({length:101},()=>({id:crypto.randomUUID(),cells:['','','']})),b=>b.headerRow=null]){
    const copy=structuredClone(base);corrupt(copy.blocks[0]);assert.throws(()=>validateNotebook(copy));
  }
  for(const action of ['table_row_remove','table_column_remove']){
    const page=emptyNotebook(),b=makeBlock('table',{rowCount:1,columnCount:1});page.blocks.push(b);
    assert.throws(()=>applyAction(page,action,{blockId:b.id,...(action==='table_row_remove'?{rowId:b.rows[0].id}:{columnId:b.columns[0].id})}),/at least one/);
  }
});

test('nested tables persist, import/export, immutable snapshots, undo/redo and failed writes',async()=>{
  const map=new Map(),storage={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
  let store=await createStore(storage,{initial:emptyNotebook});
  const tabs=(await store.dispatch('add_block',{type:'tabs'})).block;
  const toggle=(await store.dispatch('add_block',{type:'toggle',containerId:tabs.tabs[1].id})).block;
  const accordion=(await store.dispatch('add_block',{type:'accordion',containerId:toggle.id})).block;
  const table=(await store.dispatch('add_block',{type:'table',containerId:accordion.items[0].id,rowCount:1,columnCount:1})).block;
  const input={blockId:table.id,rowId:table.rows[0].id,columnId:table.columns[0].id,text:'Việt 日本語'};
  await store.dispatch('table_cell_update',input);
  const original=await store.export(),snapshot=store.getRenderState();assert.ok(Object.isFrozen(snapshot));
  await store.dispatch('table_column_add',{blockId:table.id,index:0});await store.undo();assert.deepEqual(content(await store.export()),content(original));await store.redo();await store.undo();
  const beforeFailure=await store.export(),restore=failWrites(store);await assert.rejects(()=>store.dispatch('table_cell_update',{...input,text:'lost'}),/quota/);restore();assert.equal(await store.export(),beforeFailure);
  const invalid=JSON.parse(original);invalid.pages[0].blocks[0].tabs[1].blocks[0].blocks[0].items[0].blocks[0].rows[0].cells=[];await assert.rejects(()=>store.import(JSON.stringify(invalid)),/rectangular/);assert.equal(await store.export(),beforeFailure);
  await store.dispatch('move_block',{blockId:table.id,containerId:'page'});await store.undo();assert.deepEqual(content(await store.export()),content(original));
  await store.dispatch('remove_block',{blockId:table.id});await store.undo();assert.deepEqual(content(await store.export()),content(original));
  const beforeClose=await store.export();await store.close();store=await createStore(storage);assert.equal(await store.export(),beforeClose);
  await store.import(original);assert.deepEqual((await store.getNotebook()).pages[0].blocks[0].tabs[1].blocks[0].blocks[0].items[0].blocks[0],table.type==='table'?{...table,rows:[{...table.rows[0],cells:['Việt 日本語']}]}:table);
  await store.close();
});

test('WebMCP table tools use validated shared store, including inactive pages',async()=>{
  const store=await createStore({getItem:()=>null,setItem:()=>{}},{initial:emptyNotebook}),tools=createTools(store);
  const call=(name,input)=>tools.find(t=>t.name===`omd_${name}`).execute(input);
  const active=store.getActivePageId(),pageId=(await call('page_add',{title:'Other'})).pageId;await call('page_select',{pageId:active});
  const b=(await call('add_block',{type:'table',pageId,rowCount:2,columnCount:2})).block;
  await call('table_cell_update',{pageId,blockId:b.id,rowId:b.rows[1].id,columnId:b.columns[1].id,text:'agent'});
  assert.equal((await store.getPage(pageId)).blocks[0].rows[1].cells[1],'agent');assert.equal(store.getActivePageId(),active);
  const before=await store.export();
  for(const input of [{rowCount:101},{columnCount:21},{rowCount:0},{headerRow:'yes'}])await assert.rejects(()=>call('add_block',{pageId,type:'table',...input}));
  await assert.rejects(()=>call('table_cell_update',{pageId,blockId:b.id,rowId:b.rows[0].id,columnId:b.columns[0].id,text:42}));
  assert.equal(await store.export(),before);
  const rowId=(await call('table_row_add',{pageId,blockId:b.id,index:0})).rowId,columnId=(await call('table_column_add',{pageId,blockId:b.id,index:1})).columnId;
  await call('table_row_remove',{pageId,blockId:b.id,rowId});await call('table_column_remove',{pageId,blockId:b.id,columnId});await store.close();
});
