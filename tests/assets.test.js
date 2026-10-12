import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const read = path => readFile(resolve(root, path), 'utf8');
test('all PWA shell assets, manifest icons and relative source imports exist', async () => {
  const sw = await read('service-worker.js');
  const shell = sw.match(/const SHELL = \[([^\]]+)\]/)[1].match(/'[^']+'/g).map(x => x.slice(1,-1));
  for (const file of shell) assert.ok((await stat(resolve(root, file === './' ? 'index.html' : file))).isFile(), file);
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  assert.equal(manifest.start_url, './'); assert.equal(manifest.scope, './');
  for (const icon of manifest.icons) assert.ok((await stat(resolve(root, icon.src))).size > 0);
  for (const file of shell.filter(p => p.endsWith('.js'))) {
    const js = await read(file); const imports = [...js.matchAll(/(?:from\s*|import\()\s*['"](\.\.?\/[^'"]+)['"]/g)].map(m => m[1]);
    for (const path of imports) assert.ok((await stat(resolve(root, file, '..', path))).isFile(), `${file}: ${path}`);
  }
});
test('app content is rendered as text rather than injected HTML', async () => {
  for (const file of ['src/app.js','src/integrations.js']) assert.doesNotMatch(await read(file), /innerHTML|insertAdjacentHTML|document\.write/);
});
