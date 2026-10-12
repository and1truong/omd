import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { build } from 'esbuild';
const root = resolve(new URL('..', import.meta.url).pathname);
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
for (const name of ['index.html', 'icon.svg', 'manifest.webmanifest', 'service-worker.js', 'src', 'icons']) await cp(resolve(root, name), resolve(output, name), { recursive: true });
await build({ absWorkingDir:root, entryPoints:{'mermaid-engine':'src/mermaid-engine.js','excalidraw-engine':'src/excalidraw-engine.js'},outdir:resolve(output,'src'),bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,
  conditions:['production'],chunkNames:'chunks/[name]-[hash]',assetNames:'assets/[name]-[hash]',
  define:{'process.env.NODE_ENV':'"production"','process.env.IS_PREACT':'false'},loader:{'.woff2':'file','.woff':'file','.ttf':'file','.png':'file','.svg':'file','.wasm':'file'} });
await cp(resolve(root,'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),resolve(output,'excalidraw-assets/fonts'),{recursive:true});
const shell=['./'];
async function collect(directory,prefix='') {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const relative=prefix+entry.name;if(entry.isDirectory())await collect(resolve(directory,entry.name),relative+'/');else if(relative!=='service-worker.js')shell.push('./'+relative);
  }
}
await collect(output);
const sw = resolve(output, 'service-worker.js');
await writeFile(sw,(await readFile(sw,'utf8')).replace(/const SHELL = \[[^;]+;/,`const SHELL = ${JSON.stringify(shell.sort())};`));
const hash = createHash('sha256');
async function digest(directory) {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
    const path = resolve(directory, entry.name); hash.update(entry.name);
    if (entry.isDirectory()) await digest(path); else hash.update(await readFile(path));
  }
}
await digest(output); const version = hash.digest('hex').slice(0, 16);
await writeFile(sw, (await readFile(sw, 'utf8')).replace('__OMD_BUILD__', version));
console.log(`Built static omd into dist (cache ${version}).`);
