import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyNotebook } from '../src/model.js';
import { createStore, failWrites } from './store-helper.js';
import { startReminders } from '../src/reminders.js';
const storage = () => { const map = new Map(); return { getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v) }; };
const timers = { setInterval: () => 1, clearInterval: () => {} };

test('timer delivers overdue reminders once, keeps history, and catches up after reopening', async () => {
  const data = storage(); const store = (await createStore(data, { initial: emptyNotebook }));
  const reminder = (await store.dispatch('add_block', { type: 'reminder', title: 'Hi', dueAt: '2020-01-01T00:00:00Z' })).block;
  (await store.dispatch('set_page', { title: 'Edited' }));
  const delivered = []; const runner = startReminders(store, { timers, deliver: r => delivered.push(r), onError: e => { throw e; } });
  await runner.tick(); await runner.tick();
  assert.equal(delivered.length, 1); assert.ok(store.canUndo());
  assert.equal(delivered[0].id, reminder.id);
  runner.stop(); await runner.tick(); assert.equal(delivered.length, 1);
  const reopened = startReminders((await createStore(data)), { timers, deliver: r => delivered.push(r) });
  await reopened.tick(); assert.equal(delivered.length, 1); reopened.stop();
});

test('Web Locks serialize delivery across multiple open windows', async () => {
  const data = storage(); const one = (await createStore(data, { initial: emptyNotebook }));
  (await one.dispatch('add_block', { type: 'reminder', dueAt: '2020-01-01T00:00:00Z' }));
  const two = (await createStore(data)); let chain = Promise.resolve();
  const locks = { request(name, fn) { const next = chain.then(fn); chain = next.catch(() => {}); return next; } };
  let count = 0; const options = { timers, locks, deliver: () => { count++; }, onError: e => { throw e; } };
  const a = startReminders(one, options), b = startReminders(two, options);
  await Promise.all([a.tick(), b.tick()]); assert.equal(count, 1); a.stop(); b.stop();
});

test('failed persistence does not present a reminder or lose its pending status', async () => {
  const data = storage(); const store = (await createStore(data, { initial: emptyNotebook }));
  (await store.dispatch('add_block', { type: 'reminder', dueAt: '2020-01-01T00:00:00Z' }));
  const recover=failWrites(store); let delivered = 0, error;
  const runner = startReminders(store, { timers, deliver: () => { delivered++; }, onError: e => { error = e; } });
  await runner.tick(); assert.equal(delivered, 0); assert.match(error.message, /Could not save/); assert.equal(store.getState().blocks[0].firedAt, null); runner.stop();recover();
});
