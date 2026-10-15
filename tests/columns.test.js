import test from 'node:test';
import assert from 'node:assert/strict';
import {applyAction,emptyNotebook,makeBlock,validateNotebook,findBlock,findContainer,allowedTypes,MAX_LAYOUT_COLUMNS} from '../src/model.ts';
import {pageRecords,makeMaterializer} from '../src/records.ts';
import {createStore} from './store-helper.js';
import {createTools} from '../src/webmcp.ts';
const page=(count=4)=>({...emptyNotebook(),blocks:Array.from({length:count},(_,i)=>makeBlock('text',{text:String(i)}))});
const beside=(doc,source,target,side='right',containerId='page')=>applyAction(doc,'move_block',{blockId:source,containerId,targetBlockId:target,side}).state;
const ids=row=>row.columns.map(c=>c.blocks.map(b=>b.id));

test('left/right edge moves create ordered columns without changing block IDs or unrelated siblings',()=>{
  const original=page(),[a,b,c,d]=original.blocks.map(b=>b.id);
  let doc=beside(original,b,a);assert.deepEqual(ids(doc.blocks[0]),[[a],[b]]);assert.deepEqual(doc.blocks.slice(1).map(b=>b.id),[c,d]);
  doc=beside(doc,c,a,'left',doc.blocks[0].columns[0].id);assert.deepEqual(ids(doc.blocks[0]),[[c],[a],[b]]);
  doc=beside(doc,d,a,'right',doc.blocks[0].columns[1].id);assert.deepEqual(ids(doc.blocks[0]),[[c],[a],[d],[b]]);assert.equal(original.blocks.length,4);
});

test('columns hold vertical block lists, support extraction and collapse atomically when emptied',()=>{
  const base=page(),[a,b,c,d]=base.blocks.map(b=>b.id);let doc=beside(base,b,a),row=doc.blocks[0];
  doc=applyAction(doc,'move_block',{blockId:c,containerId:row.columns[0].id}).state;assert.deepEqual(ids(doc.blocks[0]),[[a,c],[b]]);
  doc=beside(doc,c,a,'right',doc.blocks[0].columns[0].id);assert.deepEqual(ids(doc.blocks[0]),[[a],[c],[b]]);
  doc=applyAction(doc,'remove_block',{blockId:c}).state;assert.deepEqual(ids(doc.blocks[0]),[[a],[b]]);
  doc=applyAction(doc,'move_block',{blockId:a,containerId:'page'}).state;assert.deepEqual(doc.blocks.map(b=>b.id),[b,d,a]);assert.ok(doc.blocks.every(b=>b.type!=='columns'));
});

test('12-column cap rejects growth while allowing same-row reordering of a single-block column',()=>{
  const base=page(14),all=base.blocks.map(b=>b.id);let doc=beside(base,all[1],all[0]);
  for(let i=2;i<MAX_LAYOUT_COLUMNS;i++){const row=doc.blocks[0];doc=beside(doc,all[i],all[i-1],'right',row.columns.at(-1).id);}
  const saved=JSON.stringify(doc),row=doc.blocks[0];assert.equal(row.columns.length,12);
  assert.throws(()=>beside(doc,all[12],all[11],'right',row.columns.at(-1).id),/at most 12/);assert.equal(JSON.stringify(doc),saved);
  doc=beside(doc,all[0],all[11],'right',row.columns.at(-1).id);assert.equal(doc.blocks[0].columns.length,12);assert.deepEqual(ids(doc.blocks[0]).at(-1),[all[0]]);
  doc=applyAction(doc,'move_block',{blockId:all[12],containerId:doc.blocks[0].columns[0].id}).state;
  assert.throws(()=>beside(doc,all[12],all[1],'right',doc.blocks[0].columns[0].id),/at most 12/);
});

test('cycle, stale-container and ambiguous edge moves reject without mutation',()=>{
  const base=page(),[a,b]=base.blocks.map(b=>b.id),saved=JSON.stringify(base);
  assert.throws(()=>beside(base,a,a),/itself/);assert.throws(()=>beside(base,a,b,'right','missing'),/Container/);
  assert.throws(()=>applyAction(base,'move_block',{blockId:a,containerId:'page',targetBlockId:b,side:'left',index:0}),/vertical index/);assert.equal(JSON.stringify(base),saved);
  const toggle=makeBlock('toggle');toggle.blocks=[makeBlock('text')];const nested={...emptyNotebook(),blocks:[toggle]};
  assert.throws(()=>beside(nested,toggle.id,toggle.blocks[0].id,'right',toggle.id),/descendants/);
});

test('layout containers preserve tab axes, normalized records, hidden descendants and strict imports',()=>{
  const tabs=makeBlock('tabs'),a=makeBlock('text',{text:'A'}),b=makeBlock('text',{text:'B'});tabs.tabs[0].blocks=[a,b];
  const doc=beside({...emptyNotebook(),blocks:[tabs]},b.id,a.id,'left',tabs.tabs[0].id),row=doc.blocks[0].tabs[0].blocks[0];
  assert.equal(allowedTypes(doc,row.columns[0].id).tabOrientation,'vertical');assert.equal(findBlock(doc,a.id).axes[0],'horizontal');assert.equal(findContainer(doc,row.columns[0].id).blocks[0].id,b.id);
  const records=pageRecords(doc);assert.deepEqual(makeMaterializer()(records,doc.id),doc);
  for(const record of records.values())if(record.kind==='block'&&record.data.type==='columns')assert.ok(record.data.columns.every(c=>!Object.hasOwn(c,'blocks')));
  const invalid=structuredClone(doc);invalid.blocks[0].tabs[0].blocks[0].columns.push({id:crypto.randomUUID(),blocks:[]});assert.throws(()=>validateNotebook(invalid),/empty columns/);
});

test('existing move tool persists layout transactions through undo/redo, reopen and JSON import',async()=>{
  const data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};let store=await createStore(storage,{initial:emptyNotebook});
  const a=(await store.dispatch('add_block',{type:'heading',text:'A'})).blockId,b=(await store.dispatch('add_block',{type:'text',text:'B'})).blockId;
  const tool=createTools(store).find(t=>t.name==='omd_move_block');await tool.execute({blockId:b,containerId:'page',targetBlockId:a,side:'left'});
  const saved=await store.export();assert.deepEqual(ids(store.getState().blocks[0]),[[b],[a]]);await store.undo();assert.deepEqual(store.getState().blocks.map(b=>b.id),[a,b]);await store.redo();assert.equal(store.getState().blocks[0].type,'columns');const afterHistory=await store.export();await store.close();
  store=await createStore(storage);assert.equal(await store.export(),afterHistory);await store.import(saved);assert.deepEqual(ids(store.getState().blocks[0]),[[b],[a]]);await store.close();
});
