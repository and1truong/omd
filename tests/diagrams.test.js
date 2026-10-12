import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.js';
import { emptyNotebook } from '../src/model.js';
import { parseScene, mermaidSource } from '../src/scene.js';
import { createTools } from '../src/webmcp.js';
const setup=()=>{const m=new Map();return createStore({getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)},{initial:emptyNotebook});};
const rectangle={id:'shape-1',type:'rectangle',x:10,y:20,width:100,height:60};
test('Mermaid stores raw and fenced Markdown without losing invalid source',()=>{
  const store=setup(),id=store.dispatch('add_block',{type:'mermaid',source:'flowchart LR\n A --> B'}).blockId;
  assert.equal(mermaidSource('```mermaid\nflowchart LR\n A --> B\n```'),'flowchart LR\n A --> B');
  store.dispatch('update_block',{blockId:id,patch:{source:'Incomplete diagram'}});
  assert.equal(store.getState().blocks[0].source,'Incomplete diagram');
  const restored=setup();restored.import(store.export());assert.equal(restored.getState().blocks[0].source,'Incomplete diagram');
});
test('Excalidraw scenes round-trip with image files and viewport settings across pages',()=>{
  const store=setup(),id=store.dispatch('add_block',{type:'excalidraw'}).blockId;
  const scene={elements:[rectangle],appState:{scrollX:25,scrollY:60,zoom:{value:1.25}},files:{photo:{id:'photo',dataURL:'data:image/png;base64,abc',mimeType:'image/png',created:1}}};
  store.dispatch('update_block',{blockId:id,patch:{scene}});store.dispatch('page_add',{title:'Other'});
  const exported=store.export(),restored=setup();restored.import(exported);assert.deepEqual(restored.getNotebook().pages[0].blocks[0].scene,scene);
  assert.deepEqual(parseScene(JSON.stringify({type:'excalidraw',version:2,source:'omd',...scene})),scene);
});
test('malformed and unsafe scenes are rejected atomically',()=>{
  const store=setup(),id=store.dispatch('add_block',{type:'excalidraw'}).blockId,before=store.export();
  for(const scene of [{elements:[{...rectangle,x:NaN}],appState:{},files:{}},{elements:[rectangle,rectangle],appState:{},files:{}},{elements:[],appState:JSON.parse('{"__proto__":{"polluted":true}}'),files:{}}])assert.throws(()=>store.dispatch('update_block',{blockId:id,patch:{scene}}));
  assert.equal(store.export(),before);assert.equal({}.polluted,undefined);
});
test('diagram WebMCP tools share storage and real fullscreen callbacks',async()=>{
  const store=setup();let open,closed=false;const tools=createTools(store,{openCanvas:(...args)=>{open=args;},closeCanvas:()=>{closed=true;}});
  assert.equal(tools.length,50);const call=(name,args={})=>tools.find(t=>t.name===`omd_${name}`).execute(args);
  const b=(await call('add_block',{type:'excalidraw'})).block;
  await call('excalidraw_set_scene',{blockId:b.id,json:JSON.stringify({elements:[rectangle],appState:{},files:{}})});
  assert.equal(store.getState().blocks[0].scene.elements[0].id,'shape-1');
  await call('open_canvas',{blockId:b.id});assert.equal(open[0],b.id);await call('close_canvas');assert.ok(closed);
  await assert.rejects(()=>call('excalidraw_set_scene',{blockId:b.id,json:'{}'}));
});
