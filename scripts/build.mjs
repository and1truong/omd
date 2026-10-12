import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(new URL('..', import.meta.url).pathname);
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
for (const name of ['index.html', 'icon.svg', 'manifest.webmanifest', 'service-worker.js', 'src', 'icons']) await cp(resolve(root, name), resolve(output, name), { recursive: true });
const hash = createHash('sha256');
async function digest(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name); hash.update(entry.name);
    if (entry.isDirectory()) await digest(path); else hash.update(await readFile(path));
  }
}
await digest(output); const version = hash.digest('hex').slice(0, 16);
const sw = resolve(output, 'service-worker.js'); await writeFile(sw, (await readFile(sw, 'utf8')).replace('__OMD_BUILD__', version));
console.log(`Built static omd into dist (cache ${version}).`);
