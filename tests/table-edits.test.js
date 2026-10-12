import test from 'node:test';
import assert from 'node:assert/strict';
import {createCompositionGuard} from '../src/composition.ts';
import {createTableEdits,createNativeEdits} from '../src/table-edits.ts';

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

test('native title/page drafts survive failure, retry their captured identity, and expose aggregate errors',async()=>{
  const writes=[];let fail=true,changes=0;
  const store={dispatch:async(name,input)=>{writes.push({name,input});if(fail)throw new Error('quota');},idle:async()=>{}};
  const edits=createNativeEdits(store,createCompositionGuard(),()=>changes++);
  const title={kind:'title',pageId:'page-a',blockId:'table-a'},page={kind:'page',pageId:'page-a',field:'subtitle'},cell={kind:'cell',pageId:'page-a',blockId:'table-a',rowId:'row-a',columnId:'column-a'};
  await assert.rejects(()=>edits.write(title,'Nháp tiêu đề','table title'),/quota/);
  await assert.rejects(()=>edits.write(page,'日本語','Page description'),/quota/);
  fail=false;await edits.write(cell,'saved cell','Table cell');
  assert.equal(edits.list().length,2);assert.equal(edits.list().filter(draft=>draft.error).length,2);
  assert.equal(edits.value(title,'old'),'Nháp tiêu đề');assert.equal(edits.value({...title,pageId:'page-b'},'different'),'different');
  await edits.flushAll();assert.equal(edits.list().length,0);assert.ok(changes>0);
  assert.deepEqual(writes.slice(-2),[{name:'update_block',input:{pageId:'page-a',blockId:'table-a',patch:{title:'Nháp tiêu đề'}}},{name:'set_page',input:{pageId:'page-a',subtitle:'日本語'}}]);
});

test('deleted targets remain recoverable and block flush until explicitly discarded, never retargeted',async()=>{
  const writes=[];let removed=false;
  const store={dispatch:async(name,input)=>{writes.push(input);if(removed&&input.rowId==='removed')throw new Error('Item not found.');},idle:async()=>{}};
  const edits=createNativeEdits(store,createCompositionGuard()),orphan={kind:'cell',pageId:'page-a',blockId:'table',rowId:'removed',columnId:'col'},existing={...orphan,rowId:'existing'};
  removed=true;await assert.rejects(()=>edits.write(orphan,'Copy me','Original row'),/not found/);const id=edits.list()[0].id;
  await edits.write(existing,'Kept row','Existing row');await assert.rejects(()=>edits.flushAll(),/not found/);
  await assert.rejects(()=>edits.retry(id),/not found/);assert.equal(edits.list()[0].value,'Copy me');assert.deepEqual(edits.list()[0].target,orphan);
  edits.discard(id);await edits.flushAll();assert.equal(edits.list().length,0);
  assert.ok(writes.filter(write=>write.text==='Copy me').every(write=>write.rowId==='removed'));
});

test('composition stages native drafts before writes and pending writes cannot be discarded',async()=>{
  let resolve;const pending=new Promise(r=>resolve=r),writes=[];
  const store={dispatch:async(name,input)=>{writes.push(input);await pending;},idle:async()=>{}};
  const edits=createNativeEdits(store,createCompositionGuard()),target={kind:'page',pageId:'captured',field:'title'};
  edits.stage(target,'Việt 日本語','Page title');assert.equal(edits.value(target,'Old'),'Việt 日本語');assert.equal(writes.length,0);
  const saving=edits.retry(edits.id(target));assert.throws(()=>edits.discard(edits.id(target)),/finish saving/);
  resolve();await saving;assert.equal(edits.list().length,0);assert.equal(writes[0].pageId,'captured');
});

test('flush includes native drafts added while an unrelated queued write is settling',async()=>{
  let release,waiting;const idle=new Promise(resolve=>release=resolve),started=new Promise(resolve=>waiting=resolve),writes=[];
  const store={dispatch:async(name,input)=>writes.push(input),idle:async()=>{waiting();await idle;}};
  const edits=createNativeEdits(store,createCompositionGuard()),target={kind:'page',pageId:'captured',field:'subtitle'};
  const flushing=edits.flushAll();await started;edits.stage(target,'Arrived while waiting','Page description');release();await flushing;
  assert.deepEqual(writes,[{pageId:'captured',subtitle:'Arrived while waiting'}]);assert.equal(edits.list().length,0);
});

test('non-settling flush skips native preedit but strict barriers still wait for final composition',async()=>{
  const writes=[];let composing=true,finish;
  const composition={settled:()=>new Promise(resolve=>finish=()=>{composing=false;resolve();}),isComposingTarget:target=>target.kind==='page'&&composing};
  const edits=createNativeEdits({dispatch:async(name,input)=>writes.push(input),idle:async()=>{}},composition),target={kind:'page',pageId:'captured',field:'title'};
  edits.stage(target,'Preedit Việt','Page title');await edits.flushAll({settle:false});assert.equal(writes.length,0);assert.equal(edits.list().length,1);
  let done=false;const strict=edits.flushAll().then(()=>done=true);await Promise.resolve();assert.equal(done,false);
  edits.stage(target,'Final 日本語','Page title');finish();await strict;assert.deepEqual(writes,[{pageId:'captured',title:'Final 日本語'}]);assert.equal(edits.list().length,0);
});

test('an in-flight native write never recursively commits preedit or clears its pending draft',async()=>{
  for(const target of [{kind:'page',pageId:'page',field:'title'},{kind:'title',pageId:'page',blockId:'block'},{kind:'cell',pageId:'page',blockId:'block',rowId:'row',columnId:'column'}]){
    let release,started,composing=false;const gate=new Promise(resolve=>release=resolve),first=new Promise(resolve=>started=resolve),writes=[];
    const edits=createNativeEdits({dispatch:async(name,input)=>{writes.push(input);if(writes.length===1){started();await gate;}},idle:async()=>{}},{settled:async()=>{},isComposingTarget:()=>composing});
    const saving=edits.write(target,'Before IME','Native field');await first;composing=true;edits.stage(target,'PREEDIT','Native field');release();await saving;
    assert.equal(writes.length,1);assert.equal(edits.value(target,'saved'),'PREEDIT');assert.equal(edits.list().length,1);
    await edits.flushAll({settle:false});assert.equal(writes.length,1);
    await edits.write(target,'Final Việt 日本語','Native field');assert.equal(writes.length,2);assert.equal(edits.list().length,0);composing=false;await edits.flushAll();assert.equal(writes.length,2);
  }
});

test('a final value queued behind a prior write remains committable during the next composition',async()=>{
  let release,started,composing=false;const gate=new Promise(resolve=>release=resolve),first=new Promise(resolve=>started=resolve),writes=[];
  const edits=createNativeEdits({dispatch:async(name,input)=>{writes.push(input.title);if(writes.length===1){started();await gate;}},idle:async()=>{}},{settled:async()=>{},isComposingTarget:()=>composing}),target={kind:'page',pageId:'page',field:'title'};
  const saving=edits.write(target,'Before','Page title');await first;composing=true;edits.stage(target,'First preedit','Page title');const final=edits.write(target,'First final','Page title');
  edits.stage(target,'Second PREEDIT','Page title');release();await Promise.all([saving,final]);assert.deepEqual(writes,['Before','First final']);assert.equal(edits.value(target,'saved'),'Second PREEDIT');
  await edits.write(target,'Second final','Page title');assert.deepEqual(writes,['Before','First final','Second final']);assert.equal(edits.list().length,0);
});
