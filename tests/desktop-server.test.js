import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {request} from 'node:http';
import {startServer} from '../desktop/server.mjs';

test('desktop assets bind only loopback, reject other hosts and cannot escape their root',async()=>{
  const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));
  const port=probe.address().port;await new Promise(r=>probe.close(r));
  const root=await mkdtemp(join(tmpdir(),'omd-assets-'));
  await writeFile(join(root,'index.html'),'<h1>OMD</h1>');
  await symlink(join(tmpdir(),'outside-omd'),join(root,'escape'));
  const origin=`http://127.0.0.1:${port}`,server=await startServer(root,origin);
  try{
    for(const path of ['/','/page/example','/page/a%2Fb'])assert.equal(await (await fetch(origin+path)).text(),'<h1>OMD</h1>');
    assert.equal((await fetch(origin,{method:'HEAD'})).headers.get('content-length'),'12');
    assert.equal((await fetch(origin,{method:'POST'})).status,405);
    const wrongHost=await new Promise((resolve,reject)=>{const req=request(origin,{headers:{Host:'attacker.example'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
    assert.equal(wrongHost,421);
    for(const path of ['/escape','/%2e%2e%2foutside-omd','/missing','/%ZZ'])assert.equal((await fetch(origin+path)).status,404);
    await assert.rejects(startServer(root,origin),{code:'EADDRINUSE'});
    await assert.rejects(startServer(root,`http://0.0.0.0:${port}`));
  }finally{await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
});
