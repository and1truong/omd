import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true }); await mkdir(output, { recursive: true });
for (const name of ['index.html', 'icon.svg', 'manifest.webmanifest', 'icons']) await cp(resolve(root, name), resolve(output, name), { recursive: true });
await cp(resolve(output,'index.html'),resolve(output,'404.html'));
await build({entryPoints:[resolve(root,'service-worker.ts')],outfile:resolve(output,'service-worker.js'),format:'iife',target:'es2022'});
await mkdir(resolve(output,'src'),{recursive:true});await cp(resolve(root,'src/styles.css'),resolve(output,'src/styles.css'));
const modules=(await readdir(resolve(root,'src'))).filter(name=>name.endsWith('.ts')&&!name.endsWith('.d.ts')&&name!=='types.ts').map(name=>'src/'+name);
await build({absWorkingDir:root,entryPoints:modules,outdir:resolve(output,'src'),format:'esm',platform:'browser',target:'es2022'});
const engines=await build({ absWorkingDir:root, entryPoints:{'state-engine':'src/state-engine.ts','bridge-engine':'src/bridge-engine.ts','text-editor-engine':'src/text-editor-engine.ts','mermaid-engine':'src/mermaid-engine.ts','excalidraw-engine':'src/excalidraw-engine.ts'},outdir:resolve(output,'src'),bundle:true,splitting:true,format:'esm',platform:'browser',target:'es2022',minify:true,metafile:!!process.env.OMD_BUILD_METAFILE,
  conditions:['production'],chunkNames:'chunks/[name]-[hash]',assetNames:'assets/[name]-[hash]',
  define:{'process.env.NODE_ENV':'"production"','process.env.IS_PREACT':'false'},loader:{'.woff2':'file','.woff':'file','.ttf':'file','.png':'file','.svg':'file','.wasm':'file'} });
if(process.env.OMD_BUILD_METAFILE)await writeFile(process.env.OMD_BUILD_METAFILE,JSON.stringify(engines.metafile,null,2)+'\n');
await cp(resolve(root,'node_modules/@excalidraw/excalidraw/dist/prod/fonts'),resolve(output,'excalidraw-assets/fonts'),{recursive:true});
const shell=['./'];
async function collect(directory,prefix='') {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const relative=prefix+entry.name;if(entry.isDirectory())await collect(resolve(directory,entry.name),relative+'/');else if(relative!=='service-worker.js')shell.push('./'+relative);
  }
}
await collect(output);
const sw=resolve(output,'service-worker.js');
await writeFile(sw,(await readFile(sw,'utf8')).replace(/(?:const|var|let) SHELL = \[[^;]+;/,`const SHELL = ${JSON.stringify(shell.sort())};`));
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
