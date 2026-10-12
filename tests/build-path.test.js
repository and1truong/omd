import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
test('source checkout builds in a path containing spaces', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'omd source '));
  const encodedFolder = pathToFileURL(folder).pathname;
  try {
    for (const name of ['scripts', 'src', 'package.json', 'service-worker.ts', 'index.html', 'icon.svg', 'manifest.webmanifest', 'icons']) {
      await cp(join(root, name), join(folder, name), { recursive: true });
    }
    await symlink(join(root, 'node_modules'), join(folder, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    execFileSync(process.execPath, ['scripts/build.mjs'], { cwd: folder, stdio: 'pipe' });
    const html = await readFile(join(folder, 'dist/index.html'), 'utf8');
    assert.equal(await readFile(join(folder, 'dist/404.html'), 'utf8'), html);
    assert.match(html, /oh my day/);
    assert.doesNotMatch(await readFile(join(folder, 'dist/service-worker.js'), 'utf8'), /__OMD_BUILD__/);
    assert.ok((await readFile(join(folder, 'dist/src/integrations.js'), 'utf8')).length > 0);
  } finally {
    await rm(folder, { recursive: true, force: true });
    if (encodedFolder !== folder) await rm(encodedFolder, { recursive: true, force: true });
  }
});
