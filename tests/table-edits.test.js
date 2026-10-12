import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompositionGuard} from '../src/composition.ts';
import {createTableEdits} from '../src/table-edits.ts';

test('failed cell writes retain the draft and retry captured identity before navigation',async()=>{
  const writes=[];let fail=true;
  const store={dispatch:async(name,input)=>{writes.push({name,input});if(fail)throw new Error('quota');},idle:async()=>{}};
  const edits=createTableEdits(store,createCompositionGuard());
  await assert.rejects(()=>edits.write('page-a','block-a','row-a','col-a','nháp'),/quota/);
  assert.equal(edits.value('page-a','block-a','row-a','col-a','saved'),'nháp');
  await assert.rejects(()=>edits.flushAll(),/quota/);fail=false;await edits.flushAll();
  assert.deepEqual(writes.at(-1).input,{pageId:'page-a',blockId:'block-a',rowId:'row-a',columnId:'col-a',text:'nháp'});
  assert.equal(edits.value('page-a','block-a','row-a','col-a','saved'),'saved');
});

test('queued edits preserve the latest draft and flush waits through final composition save',async()=>{
  let resolve;const first=new Promise(r=>resolve=r),writes=[];
  const store={dispatch:async(name,input)=>{writes.push(input);if(writes.length===1)await first;},idle:async()=>{}};
  const composition=createCompositionGuard(),edits=createTableEdits(store,composition),input=new EventTarget();
  const a=edits.write('page','block','row','col','a'),b=edits.write('page','block','row','col','b');resolve();await Promise.all([a,b]);assert.deepEqual(writes.map(w=>w.text),['a','b']);
  composition.track(input,pageId=>edits.write(pageId,'block','row','col','日本語'),()=> 'captured-page');
  input.dispatchEvent(new Event('compositionstart'));let done=false;const flush=edits.flushAll().then(()=>done=true);await Promise.resolve();assert.equal(done,false);
  input.dispatchEvent(new Event('compositionend'));await flush;assert.equal(writes.at(-1).pageId,'captured-page');assert.equal(writes.at(-1).text,'日本語');
});

test('scoped composition waits do not block unrelated composing editors',async()=>{
  const composition=createCompositionGuard(),table=new EventTarget(),other=new EventTarget();let writes=0;
  for(const input of [table,other])composition.track(input,()=>writes++,()=> 'page');
  other.dispatchEvent(new Event('compositionstart'));await composition.settled(input=>input===table);assert.equal(composition.hasActive(),true);
  table.dispatchEvent(new Event('compositionstart'));let done=false;const waiting=composition.settled(input=>input===table).then(()=>done=true);
  await Promise.resolve();assert.equal(done,false);table.dispatchEvent(new Event('compositionend'));await waiting;assert.equal(writes,1);assert.equal(composition.hasActive(),true);
  other.dispatchEvent(new Event('compositionend'));await composition.settled();assert.equal(writes,2);
});
