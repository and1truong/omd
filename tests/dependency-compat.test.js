import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {dirname} from 'node:path';
const require=createRequire(import.meta.url);
test('both patched Nanoid generations preserve the ESM API and supported canvas ID sizes',async()=>{
  for(const consumer of ['@excalidraw/excalidraw','@excalidraw/mermaid-to-excalidraw']){
    const from=dirname(require.resolve(consumer));
    const {nanoid,customAlphabet}=await import(require.resolve('nanoid',{paths:[from]}));
    assert.equal(nanoid().length,21);assert.equal(nanoid(40).length,40);assert.equal(nanoid(1.5).length,1);
    const ids=Array.from({length:100},()=>nanoid());assert.equal(new Set(ids).size,ids.length);assert.ok(ids.every(id=>/^[\w-]{21}$/.test(id)));
    assert.equal(customAlphabet('abc',0)(),'','Zero-size custom generator must terminate (GHSA-2v37-7h3g-55p8).');
    const nonSecure=await import(require.resolve('nanoid/non-secure',{paths:[from]}));
    assert.equal(nonSecure.nanoid(-1),'','Negative-size non-secure generator must terminate (GHSA-28wg-ghj8-5hjv).');
  }
});
