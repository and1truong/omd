import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools, registerWebMCP } from '../src/webmcp.ts';
import { createStore } from './store-helper.js';
import { emptyNotebook } from '../src/model.ts';
async function setup() {
  const map = new Map(); const store = (await createStore({ getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }, { initial: emptyNotebook }));
  return store;
}
const call = (tools, name, input = {}) => tools.find(t => t.name === `omd_${name}`).execute(input);

test('checklist tools expose nested parent selection and reject fifth levels and cycles',async()=>{
  const store=await setup(),tools=createTools(store),blockId=(await call(tools,'add_block',{type:'checklist'})).blockId;
  const root=(await call(tools,'checklist_add',{blockId,text:'Root'})).itemId;
  let parentId=root;
  for(let level=2;level<=4;level++)parentId=(await call(tools,'checklist_add',{blockId,parentId,text:`Level ${level}`})).itemId;
  const before=await store.export();
  await assert.rejects(()=>call(tools,'checklist_add',{blockId,parentId}),/4 levels/);
  await assert.rejects(()=>call(tools,'checklist_add',{blockId,parentId:42}),/text/);
  await assert.rejects(()=>call(tools,'checklist_move',{blockId,itemId:root,parentId,index:0}),/descendants/);
  assert.equal(await store.export(),before);
  await call(tools,'checklist_update',{blockId,itemId:parentId,patch:{done:true}});
  await call(tools,'checklist_move',{blockId,itemId:parentId,parentId:'',index:1});
  const page=await call(tools,'get_notebook');assert.equal(page.blocks[0].items[1].done,true);const stamp=page.blocks[0].items[1].completedAt;assert.ok(Number.isFinite(Date.parse(stamp)));await call(tools,'checklist_update',{blockId,itemId:parentId,patch:{done:true}});assert.equal((await call(tools,'get_notebook')).blocks[0].items[1].completedAt,stamp);
  await call(tools,'checklist_remove',{blockId,itemId:root});
  assert.equal((await call(tools,'get_notebook')).blocks[0].items.length,1);await store.close();
});

test('registered tools execute shared actions and read back their persistent results', async () => {
  const store = (await setup()); const registry = new Map();
  const registered = await registerWebMCP(store, {}, { registry: { registerTool(tool, { signal }) { registry.set(tool.name, tool); signal.addEventListener('abort', () => registry.delete(tool.name)); } } });
  assert.ok(registered.supported); assert.equal(registered.count, 55);
  const tools = [...registry.values()];
  const outer = (await call(tools, 'add_block', { type: 'tabs', orientation: 'horizontal' })).block;
  const inner = (await call(tools, 'add_block', { type: 'tabs', orientation: 'vertical', containerId: outer.tabs[0].id })).block;
  const checklist = (await call(tools, 'add_block', { type: 'checklist', containerId: inner.tabs[0].id })).block;
  const item = (await call(tools, 'checklist_add', { blockId: checklist.id, text: 'Via the agent' })).itemId;
  await call(tools, 'checklist_update', { blockId: checklist.id, itemId: item, patch: { done: true } });
  const page = await call(tools, 'get_notebook');
  assert.equal(page.blocks[0].tabs[0].blocks[0].tabs[0].blocks[0].items[0].done, true);
  assert.equal(JSON.parse((await call(tools, 'export_notebook')).json).revision, page.revision);
  registered.cleanup(); assert.equal(registry.size, 0);
});

test('tool validation rejects invalid types, missing IDs, unknown fields, third-level tabs and inappropriate patches atomically', async () => {
  const store = (await setup()); const tools = createTools(store);
  await assert.rejects(() => call(tools, 'add_block', { type: 'unknown' }), /one of/);
  await assert.rejects(() => call(tools, 'remove_block', {}), /required/);
  await assert.rejects(() => call(tools, 'set_page', { title: 3 }), /text/);
  await assert.rejects(() => call(tools, 'set_page', { hidden: true }), /Unknown/);
  const outer = (await call(tools, 'add_block', { type: 'tabs' })).block;
  const inner = (await call(tools, 'add_block', { type: 'tabs', orientation: 'vertical', containerId: outer.tabs[0].id })).block;
  const before = (await store.export());
  await assert.rejects(() => call(tools, 'add_block', { type: 'tabs', containerId: inner.tabs[0].id }), /two levels/);
  await assert.rejects(() => call(tools, 'update_block', { blockId: outer.id, patch: { text: 'bad' } }), /Unknown field/);
  await assert.rejects(() => call(tools, 'tab_move', { blockId: outer.id, tabId: outer.tabs[0].id, index: -1 }), /integer/);
  assert.equal((await store.export()), before);
});

test('agent imports require actual user confirmation and backup before replacement', async () => {
  const store = (await setup()); const json = (await store.export()); await (await store.dispatch('set_page', { title: 'Keep me' }));
  const backup = []; let approve = false;
  const tools = createTools(store, { confirmImport: async () => approve, download: value => backup.push(value) });
  assert.deepEqual(await call(tools, 'import_notebook', { json }), { imported: false, reason: 'cancelled' });
  assert.equal(store.getState().title, 'Keep me'); assert.equal(backup.length, 0);
  approve = true; await call(tools, 'import_notebook', { json });
  assert.equal(JSON.parse(backup[0]).pages[0].title, 'Keep me'); assert.equal(store.getState().title, 'My day, on a page');
  await assert.rejects(() => call(tools, 'import_notebook', { json: '{}' }), /version/);
});

test('unsupported browsers and failed registration leave the notebook usable', async () => {
  const store = (await setup()); const statuses = [];
  assert.equal((await registerWebMCP(store, {}, { registry: {}, onStatus: value => statuses.push(value) })).supported, false);
  let signal;
  const result = await registerWebMCP(store, {}, { registry: { registerTool(tool, opts) { signal = opts.signal; throw new Error('no'); } } });
  assert.equal(result.count, 0); assert.ok(signal.aborted);
  (await store.dispatch('set_page', { title: 'Still works' })); assert.equal(store.getState().title, 'Still works');
});

test('permission and install tools report awaiting user action instead of claiming completion', async () => {
  const store = (await setup()); let opened = 0; const tools = createTools(store, { openSettings: () => opened++, notificationPermission: () => 'default' });
  for (const name of ['prepare_notification_permission', 'prepare_install', 'prepare_persistent_storage']) {
    assert.equal((await call(tools, name)).status, 'awaiting_user_action');
  }
  assert.equal(opened, 3);
});

test('agent cancellation does not apply an imported page', async () => {
  const store = (await setup()); const signal = new AbortController(); const tools = createTools(store, { confirmImport: async () => { signal.abort(); return true; }, download: () => { throw new Error('must not download'); } });
  const result = await tools.find(t => t.name === 'omd_import_notebook').execute({ json: (await store.export()) }, { signal: signal.signal });
  assert.equal(result.imported, false);
});
test('cancellation while awaiting editor flush or store idle prevents the tool mutation',async()=>{
  for(const stage of ['flush','idle']){
    const store=await setup(),controller=new AbortController();let release,entered;
    const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const wait=()=>{entered();return gate;};
    const originalIdle=store.idle;if(stage==='idle')store.idle=wait;
    const tools=createTools(store,stage==='flush'?{flushPending:wait}:{});
    const executing=tools.find(t=>t.name==='omd_set_page').execute({title:'Cancelled edit'},{signal:controller.signal});
    await waiting;controller.abort();release();await assert.rejects(()=>executing,/cancelled/);
    assert.equal(store.getRevision(),0);assert.equal(store.getState().title,'My day, on a page');
    store.idle=originalIdle;await store.close();
  }
});
test('cancellation while downloading an import backup preserves the current notebook',async()=>{
  const store=await setup(),json=await store.export(),controller=new AbortController();
  await store.dispatch('set_page',{title:'Keep this notebook'});const before=await store.export();
  let release,entered;const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const tools=createTools(store,{confirmImport:async()=>true,download:()=>{entered();return gate;}});
  const importing=tools.find(t=>t.name==='omd_import_notebook').execute({json},{signal:controller.signal});
  await waiting;controller.abort();release();assert.deepEqual(await importing,{imported:false,reason:'cancelled'});
  assert.equal(await store.export(),before);await store.close();
});
test('canvas tools wait for async UI completion and propagate rejected operations',async()=>{
  const store=await setup();let release,finished=false;const gate=new Promise(resolve=>{release=resolve;});const tools=createTools(store,{openCanvas:async()=>{await gate;finished=true;},closeCanvas:async()=>{throw new Error('Could not save canvas.');}});
  const opening=call(tools,'open_canvas',{blockId:'canvas'});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);release();assert.deepEqual(await opening,{opened:true});assert.equal(finished,true);
  await assert.rejects(()=>call(tools,'close_canvas'),/Could not save/);await store.close();
});

test('destructive tools request composition settlement before mutation, including cancellation',async()=>{
  const store=await setup(),blockId=(await store.dispatch('add_block',{type:'heading',text:'Keep me'})).blockId;
  let release,entered,requested;const waiting=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
  const tools=createTools(store,{flushPending:options=>{requested=options;entered();return gate;}}),controller=new AbortController();
  const deleting=tools.find(t=>t.name==='omd_remove_block').execute({blockId},{signal:controller.signal});
  await waiting;assert.deepEqual(requested,{waitForComposition:true});assert.equal(store.getState().blocks.length,1);
  controller.abort();release();await assert.rejects(()=>deleting,/cancelled/);assert.equal(store.getState().blocks.length,1);
  await store.close();
});

test('import rejects changes made while the backup is downloading',async()=>{
  const store=await setup(),json=await store.export();let optionsSeen=[];
  const tools=createTools(store,{flushPending:options=>optionsSeen.push(options),confirmImport:async()=>true,download:()=>store.dispatch('set_page',{title:'Edit during backup'})});
  await assert.rejects(()=>call(tools,'import_notebook',{json}),/changed during backup/);
  assert.equal(store.getState().title,'Edit during backup');assert.ok(optionsSeen.every(options=>options.waitForComposition));await store.close();
});
