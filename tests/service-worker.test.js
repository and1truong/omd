import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transform } from 'esbuild';
import { runInNewContext } from 'node:vm';

const source = await readFile(new URL('../service-worker.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'iife' });
const prefix = scope => `omd-shell-${encodeURIComponent(scope)}:`;
function worker(scope, entries) {
  const events = {}, deleted = [], opened = [], storage = new Map(entries.map(name => [name, {}]));
  let claimed = false;
  runInNewContext(code, {
    URL, Response,
    self: { registration: { scope }, location: new URL(scope), addEventListener: (name, fn) => events[name] = fn,
      skipWaiting: async () => {}, clients: { claim: async () => { claimed = true; } } },
    caches: { keys: async () => [...storage.keys()], delete: async key => { deleted.push(key); return storage.delete(key); },
      open: async key => { opened.push(key); storage.set(key, {}); return { addAll: async () => {} }; } }
  });
  const fire = async name => { let promise; events[name]({ waitUntil: value => promise = value }); await promise; };
  return { events, deleted, opened, storage, fire, claimed: () => claimed };
}

test('activation removes only old builds in its exact scope namespace', async () => {
  for (const scope of ['https://example.test/', 'https://example.test/a/', 'https://example.test/a', 'https://example.test/a:']) {
    const other = scope + 'nested/', current = prefix(scope) + '__OMD_BUILD__', old = prefix(scope) + 'old';
    const preserved = [current, prefix(other) + 'old', prefix('https://example.test/b/') + 'old',
      'omd-shell-legacy', 'omd-shell-other-app', 'unrelated-cache'];
    const sw = worker(scope, [old, ...preserved]);
    await sw.fire('activate');
    assert.deepEqual(sw.deleted, [old]);
    assert.deepEqual([...sw.storage.keys()], preserved);
    assert.equal(sw.claimed(), true);
  }
});

test('installation opens a scope-specific current build without mutating legacy caches', async () => {
  const sw = worker('https://example.test/b/', ['omd-shell-legacy']);
  await sw.fire('install');
  assert.deepEqual(sw.opened, [prefix('https://example.test/b/') + '__OMD_BUILD__']);
  assert.equal(sw.storage.has('omd-shell-legacy'), true);
});

test('fetch does not intercept another deployment or external navigation', () => {
  const sw = worker('https://example.test/a/', []);
  for (const url of ['https://example.test/b/page/id', 'https://example.test/a-other/page/id', 'https://other.test/a/page/id']) {
    let intercepted = false;
    sw.events.fetch({ request: { url, method: 'GET', mode: 'navigate' }, respondWith: () => intercepted = true });
    assert.equal(intercepted, false, url);
  }
});
