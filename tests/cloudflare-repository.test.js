import test from 'node:test';
import assert from 'node:assert/strict';
import {openCloudflareRepository} from '../src/cloudflare-repository.ts';

test('non-JSON 5xx retries reuse the exact commit request and request ID',async()=>{
  const requests=[],meta={id:'notebook',revision:1};
  const repository=await openCloudflareRepository('https://omd.example/api/notebook',async(_url,init)=>{
    requests.push(init.body);
    return requests.length===1?new Response('<h1>Bad gateway</h1>',{status:502}):Response.json({result:{}});
  });
  await repository.commit(meta,{...meta,revision:2},[]);
  assert.equal(requests.length,2);assert.equal(requests[0],requests[1]);assert.ok(JSON.parse(requests[0]).requestId);repository.close();
});

test('non-JSON errors stop after two 5xx attempts and do not retry 4xx',async()=>{
  for(const status of [503,400]){
    let attempts=0;const repository=await openCloudflareRepository('https://omd.example/api/notebook',async()=>{attempts++;return new Response('upstream error',{status});});
    await assert.rejects(()=>repository.read(),/invalid response.*not been acknowledged/);
    assert.equal(attempts,status===503?2:1);repository.close();
  }
});
