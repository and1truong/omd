import test from 'node:test';
import assert from 'node:assert/strict';
import { createTools, registerWebMCP } from '../src/webmcp.js';
import { createStore } from '../src/store.js';
import { emptyNotebook } from '../src/model.js';
function setup() {
  const map = new Map(); const store = createStore({ getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }, { initial: emptyNotebook });
  return store;
}
const call = (tools, name, input = {}) => tools.find(t => t.name === `omd_${name}`).execute(input);

test('registered tools execute shared actions and read back their persistent results', async () => {
  const store = setup(); const registry = new Map();
  const registered = await registerWebMCP(store, {}, { registry: { registerTool(tool, { signal }) { registry.set(tool.name, tool); signal.addEventListener('abort', () => registry.delete(tool.name)); } } });
  assert.ok(registered.supported); assert.equal(registered.count, 50);
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
  const store = setup(); const tools = createTools(store);
  await assert.rejects(() => call(tools, 'add_block', { type: 'unknown' }), /one of/);
  await assert.rejects(() => call(tools, 'remove_block', {}), /required/);
  await assert.rejects(() => call(tools, 'set_page', { title: 3 }), /text/);
  await assert.rejects(() => call(tools, 'set_page', { hidden: true }), /Unknown/);
  const outer = (await call(tools, 'add_block', { type: 'tabs' })).block;
  const inner = (await call(tools, 'add_block', { type: 'tabs', orientation: 'vertical', containerId: outer.tabs[0].id })).block;
  const before = store.export();
  await assert.rejects(() => call(tools, 'add_block', { type: 'tabs', containerId: inner.tabs[0].id }), /two levels/);
  await assert.rejects(() => call(tools, 'update_block', { blockId: outer.id, patch: { text: 'bad' } }), /Unknown field/);
  await assert.rejects(() => call(tools, 'tab_move', { blockId: outer.id, tabId: outer.tabs[0].id, index: -1 }), /integer/);
  assert.equal(store.export(), before);
});

test('agent imports require actual user confirmation and backup before replacement', async () => {
  const store = setup(); const json = store.export(); await store.dispatch('set_page', { title: 'Keep me' });
  const backup = []; let approve = false;
  const tools = createTools(store, { confirmImport: async () => approve, download: value => backup.push(value) });
  assert.deepEqual(await call(tools, 'import_notebook', { json }), { imported: false, reason: 'cancelled' });
  assert.equal(store.getState().title, 'Keep me'); assert.equal(backup.length, 0);
  approve = true; await call(tools, 'import_notebook', { json });
  assert.equal(JSON.parse(backup[0]).pages[0].title, 'Keep me'); assert.equal(store.getState().title, 'My day, on a page');
  await assert.rejects(() => call(tools, 'import_notebook', { json: '{}' }), /version/);
});

test('unsupported browsers and failed registration leave the notebook usable', async () => {
  const store = setup(); const statuses = [];
  assert.equal((await registerWebMCP(store, {}, { registry: {}, onStatus: value => statuses.push(value) })).supported, false);
  let signal;
  const result = await registerWebMCP(store, {}, { registry: { registerTool(tool, opts) { signal = opts.signal; throw new Error('no'); } } });
  assert.equal(result.count, 0); assert.ok(signal.aborted);
  store.dispatch('set_page', { title: 'Still works' }); assert.equal(store.getState().title, 'Still works');
});

test('permission and install tools report awaiting user action instead of claiming completion', async () => {
  const store = setup(); let opened = 0; const tools = createTools(store, { openSettings: () => opened++, notificationPermission: () => 'default' });
  for (const name of ['prepare_notification_permission', 'prepare_install', 'prepare_persistent_storage']) {
    assert.equal((await call(tools, name)).status, 'awaiting_user_action');
  }
  assert.equal(opened, 3);
});

test('agent cancellation does not apply an imported page', async () => {
  const store = setup(); const signal = new AbortController(); const tools = createTools(store, { confirmImport: async () => { signal.abort(); return true; }, download: () => { throw new Error('must not download'); } });
  const result = await tools.find(t => t.name === 'omd_import_notebook').execute({ json: store.export() }, { signal: signal.signal });
  assert.equal(result.imported, false);
});
