import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));
const { version } = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const name = `omd-v${version}`, output = join(root, 'release');
const sums = await readFile(join(output, 'SHA256SUMS.txt'), 'utf8');
for (const extension of ['zip', 'tar.gz']) {
  const filename = `${name}.${extension}`;
  const hash = createHash('sha256').update(await readFile(join(output, filename))).digest('hex');
  assert.ok(sums.includes(`${hash}  ${filename}\n`), `Checksum mismatch: ${filename}`);
  // Extract outside the checkout, in a path with spaces, with no node_modules.
  const temporary = await mkdtemp(join(tmpdir(), 'omd release '));
  let server;
  try {
    if (extension === 'zip') execFileSync('unzip', ['-q', join(output, filename), '-d', temporary]);
    else execFileSync('tar', ['-xzf', join(output, filename), '-C', temporary]);
    const folder = join(temporary, name);
    const manifest = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'));
    assert.equal(manifest.version, version); assert.equal(manifest.dependencies, undefined);
    const build = JSON.parse(await readFile(join(folder, 'BUILD.json'), 'utf8'));
    assert.equal(build.version, version); assert.match(build.commit, /^[a-f0-9]{40}$/);
    const dependencies = JSON.parse(await readFile(join(folder, 'DEPENDENCIES.json'), 'utf8'));
    for (const dependency of ['@excalidraw/excalidraw','mermaid','react','react-dom','zustand','immer']) {
      assert.ok(dependencies.some(pkg => pkg.name === dependency), `Missing ${dependency}`);
    }
    async function files(directory, prefix = '') {
      const results = [];
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        assert.notEqual(entry.name, 'node_modules');
        const path = prefix + entry.name;
        if (entry.isDirectory()) results.push(...await files(join(directory, entry.name), path + '/'));
        else results.push(path);
      }
      return results.sort();
    }
    const assets = await files(join(folder, 'dist'));
    assert.deepEqual(assets, await files(join(root, 'dist')), 'Archive must include every built asset');
    const socket = createServer();
    await new Promise(resolve => socket.listen(0, '127.0.0.1', resolve));
    const port = socket.address().port;
    await new Promise(resolve => socket.close(resolve));
    server = spawn(process.execPath, [join(folder, 'start.mjs')], {
      cwd: tmpdir(), env: { ...process.env, OMD_PORT: String(port), OMD_BASE_PATH: '' },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Packaged server did not start')), 5000);
      server.once('error', reject);
      server.once('exit', code => { clearTimeout(timeout); reject(new Error(`Packaged server exited: ${code}`)); });
      server.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
    });
    const base = `http://127.0.0.1:${port}/`;
    for (let index = 0; index < assets.length; index += 12) {
      await Promise.all(assets.slice(index, index + 12).map(async asset => {
        const response = await fetch(new URL(asset, base));
        assert.equal(response.status, 200, asset);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(root, 'dist', asset)), asset);
        if (asset.endsWith('.js')) assert.match(response.headers.get('content-type'), /^text\/javascript/);
      }));
    }
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + '%2e%2e%2fscripts%2fserve.mjs')).status, 403);
    console.log(`${filename}: extracted launcher and ${assets.length} bundled assets pass without node_modules.`);
  } finally {
    if (server && server.exitCode === null) {
      await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
    }
    await rm(temporary, { recursive: true, force: true });
  }
}
