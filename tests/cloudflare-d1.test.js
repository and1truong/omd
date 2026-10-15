import test from 'node:test';
import assert from 'node:assert/strict';
import {boundedDatabase,jsonBatches} from '../cloudflare/d1.ts';

function database(){
  let calls=0,batches=0;
  const result=()=>({results:[],meta:{changes:0}}),statement=()=>({bind(){return statement();},async first(){calls++;return null;},async all(){calls++;return result();}});
  const db=boundedDatabase({prepare:statement,async batch(statements){calls+=statements.length;batches++;return statements.map(result);}});
  return {db,get calls(){return calls;},get batches(){return batches;}};
}
test('D1 query budget counts individual batch statements and rejects before a transaction starts',async()=>{
  const fixture=database(),{db}=fixture;
  for(let i=0;i<10;i++)await db.prepare('SELECT').first();
  assert.throws(()=>db.batch(Array.from({length:41},()=>db.prepare('INSERT'))),/query budget/);
  assert.equal(fixture.calls,10);assert.equal(fixture.batches,0);
  await db.batch(Array.from({length:40},()=>db.prepare('INSERT')));assert.equal(fixture.calls,50);
  assert.throws(()=>db.prepare('SELECT').all(),/query budget/);assert.equal(fixture.calls,50);
});
test('D1 binding and JSON batching limits measure UTF-8 bytes rather than JavaScript characters',()=>{
  const {db}=database(),encoder=new TextEncoder();
  db.prepare('INSERT').bind('💡'.repeat(500_000));
  assert.throws(()=>db.prepare('INSERT').bind('💡'.repeat(500_001)),/value limit/);
  const rows=Array.from({length:20},(_,i)=>[i,'💡'.repeat(20_000)]),batches=[...jsonBatches(rows)];
  assert.ok(batches.length>1);assert.deepEqual(batches.flatMap(json=>JSON.parse(json)),rows);
  assert.ok(batches.every(json=>encoder.encode(json).byteLength<=1_000_000));
  assert.throws(()=>[...jsonBatches([['💡'.repeat(250_001)]])],/batch value limit/);
});
