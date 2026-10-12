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

test('WebMCP scalar/read flushes do not settle preedit; structural/export/history barriers stay strict',async()=>{
  const store=await setup(),table=(await store.dispatch('add_block',{type:'table'})).block,board=(await store.dispatch('add_block',{type:'kanban'})).block;
  const card=(await store.dispatch('card_add',{blockId:board.id,columnId:board.columns[0].id})).cardId,scopes=[];
  const tools=createTools(store,{flushPending:async options=>{scopes.push(options.settle);if(options.settle)throw new Error('Unresolved native preedit');}});
  await call(tools,'get_notebook');await call(tools,'card_update',{blockId:board.id,cardId:card,patch:{description:'Unrelated card'}});
  await call(tools,'update_block',{blockId:table.id,patch:{title:'Scalar title'}});
  assert.deepEqual(scopes,[false,false,false]);const before=await store.export();
  for(const [name,input] of [
    ['page_select',{pageId:store.getActivePageId()}],['table_row_add',{blockId:table.id}],['table_row_remove',{blockId:table.id,rowId:table.rows[0].id}],
    ['table_column_add',{blockId:table.id}],['table_column_remove',{blockId:table.id,columnId:table.columns[0].id}],['update_block',{blockId:table.id,patch:{headerRow:false}}],
    ['remove_block',{blockId:table.id}],['export_notebook',{}],['import_notebook',{json:before}],['undo',{}],['redo',{}]
  ]){await assert.rejects(()=>call(tools,name,input),/Unresolved native preedit/);assert.equal(scopes.at(-1),true);}
  assert.equal(await store.export(),before);await store.close();
});

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
  const page=await call(tools,'get_notebook');assert.equal(page.blocks[0].items[1].done,true);
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
test('canvas tools wait for async UI completion and propagate rejected operations',async()=>{
  const store=await setup();let release,finished=false;const gate=new Promise(resolve=>{release=resolve;});const tools=createTools(store,{openCanvas:async()=>{await gate;finished=true;},closeCanvas:async()=>{throw new Error('Could not save canvas.');}});
  const opening=call(tools,'open_canvas',{blockId:'canvas'});await new Promise(resolve=>setImmediate(resolve));assert.equal(finished,false);release();assert.deepEqual(await opening,{opened:true});assert.equal(finished,true);
  await assert.rejects(()=>call(tools,'close_canvas'),/Could not save/);await store.close();
});
