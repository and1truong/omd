// Verify the production artifact rather than relying on source-file extensions.
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
const output=resolve(new URL('../dist/',import.meta.url).pathname),files=[];
async function collect(directory){for(const entry of await readdir(directory,{withFileTypes:true})){const path=resolve(directory,entry.name);if(entry.isDirectory())await collect(path);else files.push(path);}}
await collect(output);assert.ok(files.length>0);assert.ok(files.every(path=>!path.endsWith('.ts')&&!path.endsWith('.tsx')),'Production must not publish TypeScript source/declarations.');
for(const path of files.filter(path=>path.endsWith('.js'))){const source=await readFile(path,'utf8');for(const match of source.matchAll(/(?:from\s*|import\()\s*['"](\.\.?\/[^'"]+)['"]/g)){const target=resolve(dirname(path),match[1]);assert.ok((await stat(target)).isFile(),`${path}: missing runtime module ${match[1]}`);}}
const worker=await readFile(resolve(output,'service-worker.js'),'utf8');assert.doesNotMatch(worker,/__OMD_BUILD__|export\s*\{/);const precache=JSON.parse(worker.match(/const SHELL = (\[[^;]+\]);/)[1]);for(const asset of precache)assert.ok((await stat(resolve(output,asset==='./'?'index.html':asset))).isFile(),asset);
for(const asset of ['./src/dom.js','./src/composition.js','./src/state-engine.js'])assert.ok(precache.includes(asset),`Missing offline module ${asset}`);
console.log(`Validated ${files.length} static files and ${precache.length} offline assets.`);
