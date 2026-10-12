import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium, webkit } from 'playwright';

const root = resolve(fileURLToPath(new URL('../dist/', import.meta.url)));
const mime = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const namespace = scope => `omd-shell-${encodeURIComponent(scope)}:`;

export async function verifyCacheScopes({ browser, workerSource } = {}) {
  const emitted = workerSource ?? await readFile(resolve(root, 'service-worker.js'), 'utf8');
  const build = emitted.match(/["'](?:omd-shell-)?([a-f0-9]{16})["']/)?.[1];
  assert.ok(build, 'Expected emitted build identifier');
  const legacy = emitted.replace(/const CACHE_PREFIX = [^;]+;/, 'const CACHE_PREFIX = "omd-shell-";')
    .replace('key.startsWith(CACHE_PREFIX)', 'key.startsWith("omd-shell-")');
  for (const [scopeA, scopeB, oldB] of [['/a/', '/b/', false], ['/', '/nested/', false], ['/a/', '/b/', true]]) {
    let updateA = false, stopped = false;
    const server = createServer(async (request, response) => {
      try {
        const path = new URL(request.url, 'http://localhost').pathname;
        if (path === '/probe') { response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' }); response.end('<!doctype html><title>Cache probe</title>'); return; }
        const scope = [scopeA, scopeB].sort((a, b) => b.length - a.length).find(value => path.startsWith(value));
        if (!scope) throw new Error('Outside fixture scopes');
        let relative = decodeURIComponent(path.slice(scope.length));
        if (!relative || relative.startsWith('page/')) relative = 'index.html';
        const file = resolve(root, relative);
        if (!file.startsWith(root + sep)) throw new Error('Outside fixture directory');
        let data = await readFile(file);
        if (relative.endsWith('.html')) data = Buffer.from(data.toString().replace('<head>', `<head><base href="${scope}">`));
        if (relative === 'service-worker.js') data = Buffer.from(
          scope === scopeB && oldB ? legacy : scope === scopeA && updateA ? emitted.replace(build, build + '-updated-a') : emitted);
        response.writeHead(200, { 'Content-Type': mime[extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
        response.end(data);
      } catch { response.writeHead(404); response.end('Missing fixture asset'); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const context = await browser.newContext();
    context.setDefaultTimeout(20000);
    await context.addInitScript(() => window.addEventListener('omd:ready', () => window.cacheScopeReady = true));
    const ready = page => page.waitForFunction(() => window.cacheScopeReady === true);
    const errors = [], external = [];
    context.on('page', page => {
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => { if (new URL(request.url()).origin !== origin) external.push(request.url()); });
    });
    try {
      const b = await context.newPage(); await b.goto(origin + scopeB); await ready(b);
      await b.evaluate(() => navigator.serviceWorker.ready);
      await b.waitForFunction(() => !!navigator.serviceWorker.controller);
      const id = await b.evaluate(async () => {
        const store = (await import(new URL('src/app.js', document.baseURI).href)).getStore();
        await store.dispatch('set_page', { title: 'Independent offline deployment' });
        await store.dispatch('add_block', { type: 'text', text: 'Preserved across another scope update' });
        return store.getActivePageId();
      });
      const deep = origin + scopeB + 'page/' + encodeURIComponent(id);
      const bKey = oldB ? 'omd-shell-' + build : namespace(origin + scopeB) + build;
      await b.evaluate(async () => {
        for (const name of ['omd-shell-legacy-fixture', 'unrelated-cache']) {
          await (await caches.open(name)).put('/sentinel', new Response(name));
        }
      });
      const a = await context.newPage(); await a.goto(origin + scopeA); await ready(a);
      await a.evaluate(() => navigator.serviceWorker.ready); await a.waitForFunction(() => !!navigator.serviceWorker.controller);
      const before = await b.evaluate(async key => (await (await caches.open(key)).keys()).map(request => request.url).sort(), bKey);
      assert.ok(before.includes(origin + scopeB + 'index.html'));
      assert.ok(before.some(url => url.endsWith('/src/mermaid-engine.js')));
      assert.ok(before.some(url => url.endsWith('/src/excalidraw-engine.js')));
      await a.close(); await b.close();
      const probe = await context.newPage(); await probe.goto(origin + '/probe');
      updateA = true;
      const after = await probe.evaluate(async scope => {
        const registration = await navigator.serviceWorker.getRegistration(scope);
        const previous = registration.active;
        await registration.update();
        const worker = registration.installing ?? registration.waiting ?? registration.active;
        if (worker === previous) throw new Error('Expected genuinely new worker');
        await new Promise((resolve, reject) => {
          const check = () => { if (worker.state === 'activated') resolve(); else if (worker.state === 'redundant') reject(new Error('Update became redundant')); };
          worker.addEventListener('statechange', check); check();
        });
        return caches.keys();
      }, origin + scopeA);
      assert.ok(after.includes(namespace(origin + scopeA) + build + '-updated-a'));
      assert.ok(!after.includes(namespace(origin + scopeA) + build), 'Old A build should be removed');
      assert.ok(after.includes(bKey), 'B cache must survive A activation');
      const afterB = await probe.evaluate(async key => (await (await caches.open(key)).keys()).map(request => request.url).sort(), bKey);
      assert.deepEqual(afterB, before, 'Every B cached asset must remain unchanged');
      for (const name of ['omd-shell-legacy-fixture', 'unrelated-cache']) {
        assert.equal(await probe.evaluate(async key => (await (await caches.open(key)).match('/sentinel')).text(), name), name);
      }
      await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); stopped = true;
      await assert.rejects(fetch(origin + scopeB), /fetch failed/);
      const reopened = await context.newPage(); await reopened.goto(deep); await ready(reopened);
      assert.equal(await reopened.locator('#page-title').inputValue(), 'Independent offline deployment');
      assert.ok(await reopened.getByRole('textbox', { name: 'text content', exact: true }).allInnerTexts().then(texts => texts.includes('Preserved across another scope update')));
      assert.equal(await reopened.evaluate(() => performance.getEntriesByType('resource').some(entry => /(?:mermaid|excalidraw)-engine/.test(entry.name))), false, 'Engines must be cold before first offline use');
      await reopened.evaluate(async () => {
        const store = (await import(new URL('src/app.js', document.baseURI).href)).getStore();
        await store.dispatch('add_block', { type: 'mermaid', source: 'flowchart LR\n Offline --> Preserved' });
        await store.dispatch('add_block', { type: 'excalidraw' });
      });
      await reopened.locator('.mermaid-preview svg').waitFor(); await reopened.locator('.excalidraw canvas').first().waitFor();
      await reopened.reload(); await ready(reopened);
      await reopened.locator('.mermaid-preview svg').waitFor(); await reopened.locator('.excalidraw canvas').first().waitFor();
      const fresh = await context.newPage(); await fresh.goto(deep); await ready(fresh);
      await fresh.locator('.mermaid-preview svg').waitFor(); await fresh.locator('.excalidraw canvas').first().waitFor();
      assert.equal(await fresh.locator('#page-title').inputValue(), 'Independent offline deployment');
      assert.deepEqual(errors, []);
      assert.deepEqual(external, [], 'Offline engines must not depend on external requests');
      console.log(`${scopeA} update preserves ${scopeB}${oldB ? ' legacy worker' : ''}: cache inventory, real-shutdown deep link/reload/new-tab and cold lazy engines passed.`);
    } finally {
      await context.close();
      if (!stopped) await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const engine = process.env.OMD_BROWSER ?? 'chromium';
  assert.ok(['chromium', 'webkit'].includes(engine));
  const browser = await (engine === 'webkit' ? webkit : chromium).launch({ headless: true });
  try { await verifyCacheScopes({ browser }); } finally { await browser.close(); }
}
