import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNotebook, makeBlock, validateNotebook, applyAction, parseImport, allowedTypes, dueReminders } from '../src/model.ts';
import { createStore, failWrites } from './store-helper.js';

function fixture() {
  let doc = emptyNotebook();
  return { get doc() { return doc; }, act(name, input) { const out = applyAction(doc, name, input); doc = out.state; return out.result; } };
}
function memoryStorage() {
  const entries = new Map();
  return { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
}

test('page IDs must be nonempty text without restricting valid special IDs', () => {
  for (const id of ['', null, 42, {}, []]) {
    const page = {...emptyNotebook(), id};
    assert.throws(() => validateNotebook(page), /Notebook ID must be (nonempty )?text/);
    assert.throws(() => parseImport(JSON.stringify(page)), /Notebook ID must be (nonempty )?text/);
  }
  for (const id of ['p:á/"一', '$page', '__proto__', 'constructor', ' ']) {
    const page = {...emptyNotebook(), id};
    assert.deepEqual(validateNotebook(page), page);
    assert.deepEqual(parseImport(JSON.stringify(page)), page);
  }
});

test('tabs support both alternating two-level layouts, including through hidden containers', async () => {
  for (const orientation of ['horizontal', 'vertical']) {
    const f = fixture(); const outer = f.act('add_block', { type: 'tabs', orientation }).block;
    const toggle = f.act('add_block', { type: 'toggle', containerId: outer.tabs[0].id }).block;
    const opposite = orientation === 'horizontal' ? 'vertical' : 'horizontal';
    const inner = f.act('add_block', { type: 'tabs', orientation: opposite, containerId: toggle.id }).block;
    assert.equal(allowedTypes(f.doc, toggle.id).tabOrientation, opposite);
    assert.ok(!allowedTypes(f.doc, inner.tabs[0].id).types.includes('tabs'));
    const before = structuredClone(f.doc);
    assert.throws(() => f.act('add_block', { type: 'tabs', orientation, containerId: inner.tabs[0].id }), /two levels/);
    assert.deepEqual(f.doc, before);
    assert.throws(() => f.act('update_block', { blockId: inner.id, patch: { orientation } }), /opposite/);
    assert.throws(() => f.act('update_block', { blockId: outer.id, patch: { orientation: opposite } }), /opposite/);
  }
});

test('moves validate tab ancestors and reject cycles atomically', async () => {
  const f = fixture(); const group = f.act('add_block', { type: 'tabs' }).block;
  const other = f.act('add_block', { type: 'tabs' }).block;
  assert.throws(() => f.act('move_block', { blockId: other.id, containerId: group.tabs[0].id }), /opposite/);
  const t = f.act('add_block', { type: 'toggle' }).block;
  const child = f.act('add_block', { type: 'toggle', containerId: t.id }).block;
  const before = structuredClone(f.doc);
  assert.throws(() => f.act('move_block', { blockId: t.id, containerId: child.id }), /not found|itself/i);
  assert.deepEqual(f.doc, before);
});

test('kanban supports column ordering, card ordering and cross-column moves', async () => {
  const f = fixture(); const b = f.act('add_block', { type: 'kanban' }).block;
  const a = f.act('card_add', { blockId: b.id, columnId: b.columns[0].id, title: 'A' }).cardId;
  const c = f.act('card_add', { blockId: b.id, columnId: b.columns[0].id, title: 'B' }).cardId;
  f.act('card_move', { blockId: b.id, cardId: c, columnId: b.columns[0].id, index: 0 });
  assert.deepEqual(f.doc.blocks[0].columns[0].cards.map(x => x.id), [c, a]);
  f.act('card_move', { blockId: b.id, cardId: a, columnId: b.columns[1].id, index: 0 });
  f.act('column_move', { blockId: b.id, columnId: b.columns[1].id, index: 0 });
  assert.equal(f.doc.blocks[0].columns[0].cards[0].title, 'A');
  f.act('card_update', { blockId: b.id, cardId: a, patch: { description: 'Details' } });
  f.act('card_remove', { blockId: b.id, cardId: a });
  f.act('column_remove', { blockId: b.id, columnId: b.columns[0].id });
  assert.equal(f.doc.blocks[0].columns.length, 2);
});

test('tab removal retains a valid active tab and preserves the final tab', async () => {
  const f = fixture(); const b = f.act('add_block', { type: 'tabs' }).block;
  f.act('tab_remove', { blockId: b.id, tabId: b.tabs[0].id });
  assert.equal(f.doc.blocks[0].activeTabId, b.tabs[1].id);
  assert.throws(() => f.act('tab_remove', { blockId: b.id, tabId: b.tabs[1].id }), /at least one/);
});

test('checklist and accordion CRUD and ordering', async () => {
  const f = fixture(); const list = f.act('add_block', { type: 'checklist' }).block;
  const item = f.act('checklist_add', { blockId: list.id, text: 'First' }).itemId;
  const second = f.act('checklist_add', { blockId: list.id, text: 'Second' }).itemId;
  f.act('checklist_update', { blockId: list.id, itemId: item, patch: { done: true } });
  f.act('checklist_move', { blockId: list.id, itemId: second, index: 0 });
  assert.equal(f.doc.blocks[0].items[1].done, true);
  f.act('checklist_remove', { blockId: list.id, itemId: item });
  const accordion = f.act('add_block', { type: 'accordion' }).block;
  const section = f.act('accordion_add', { blockId: accordion.id, title: 'More' }).itemId;
  f.act('accordion_move', { blockId: accordion.id, itemId: section, index: 0 });
  f.act('accordion_update', { blockId: accordion.id, itemId: section, patch: { open: false } });
  assert.equal(f.doc.blocks[1].items[0].open, false);
  f.act('accordion_remove', { blockId: accordion.id, itemId: section });
});

test('no application quota on block count, list count, text size or import bytes', async () => {
  const doc = emptyNotebook();
  for (let i = 0; i < 2100; i++) doc.blocks.push(makeBlock('text', { text: 'x'.repeat(2600) }));
  const parsed = parseImport(JSON.stringify(doc));
  assert.equal(parsed.blocks.length, 2100);
  const list = makeBlock('checklist');
  for (let i = 0; i < 1100; i++) list.items.push({ id: crypto.randomUUID(), text: String(i), done: false });
  doc.blocks = [list, makeBlock('text', { text: 'x'.repeat(30000) })];
  assert.doesNotThrow(() => validateNotebook(doc));
});

test('malformed imports and duplicate IDs are rejected without touching the current page', async () => {
  const f = fixture(); f.act('add_block', { type: 'text' });
  const bad = structuredClone(f.doc); bad.blocks.push(structuredClone(bad.blocks[0]));
  assert.throws(() => parseImport(JSON.stringify(bad)), /unique/);
  assert.throws(() => parseImport('{'), /valid JSON/);
  assert.throws(() => f.act('update_block', { blockId: f.doc.blocks[0].id, patch: { id: 'overwrite' } }), /Unknown field/);
  assert.throws(() => f.act('set_page', { theme: 'pink' }), /theme/);
  assert.equal(f.doc.blocks.length, 1);
});

test('store survives closing, round-trips imports and maintains undo/redo', async () => {
  const storage = memoryStorage(); const store = (await createStore(storage, { initial: emptyNotebook }));
  (await store.dispatch('set_page', { title: 'My work' }));
  assert.equal((await createStore(storage)).getState().title, 'My work');
  assert.ok((await store.undo())); assert.equal(store.getState().title, 'My day, on a page');
  assert.ok((await store.redo())); assert.equal(store.getState().title, 'My work');
  const raw = (await store.export()); (await store.dispatch('set_page', { title: 'Other' })); (await store.import(raw));
  assert.equal(store.getState().title, 'My work');
});

test('storage write errors preserve the live page and last saved data', async () => {
  const storage = memoryStorage(); const store = (await createStore(storage, { initial: emptyNotebook }));
  const original = (await store.export()); const recover=failWrites(store);
  await assert.rejects(async () => (await store.dispatch('set_page', { title: 'Lost' })), /Could not save/);
  assert.equal((await store.export()), original);
  assert.equal(store.canUndo(), false);recover();
});

test('corrupt persisted data is preserved and stale windows cannot overwrite newer changes', async () => {
  const storage = memoryStorage(); storage.setItem('bad', '{bad');
  await assert.rejects(async () => (await createStore(storage, { key: 'bad' })), /preserved/);
  assert.equal(storage.getItem('bad'), '{bad');
  const one = (await createStore(storage, { initial: emptyNotebook })); const two = (await createStore(storage));
  (await one.dispatch('set_page', { title: 'Newer' }));
  await assert.rejects(async () => (await two.dispatch('set_page', { title: 'Older' })), /Another window/);
  (await two.reload()); (await two.dispatch('set_page', { title: 'Now current' }));
  assert.equal((await createStore(storage)).getState().title, 'Now current');
});

test('reminders are due even inside inactive tabs and closed toggles, and only deliver once', async () => {
  const storage = memoryStorage(); const store = (await createStore(storage, { initial: emptyNotebook }));
  const tab = (await store.dispatch('add_block', { type: 'tabs' })).block;
  const r = (await store.dispatch('add_block', { type: 'reminder', containerId: tab.tabs[1].id, dueAt: '2020-01-01T00:00:00Z' })).block;
  (await store.dispatch('set_page', { title: 'Other edit' }));
  assert.equal(dueReminders(store.getState()).length, 1);
  (await store.dispatch('reminder_fired', { blockId: r.id, firedAt: new Date().toISOString() }));
  assert.equal(dueReminders((await createStore(storage)).getState()).length, 0);
  (await store.undo()); assert.equal(dueReminders(store.getState()).length, 0);
  (await store.redo()); assert.equal(dueReminders(store.getState()).length, 0);
  (await store.dispatch('update_block', { blockId: r.id, patch: { dueAt: '2021-01-01T00:00:00Z' } }));
  assert.equal(dueReminders(store.getState()).length, 1);
});
