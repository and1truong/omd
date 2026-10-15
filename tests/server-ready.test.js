import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {waitForServer} from './server-ready.mjs';

test('browser harness rejects server exit with diagnostics instead of waiting for readiness forever',async()=>{
  const child=spawn(process.execPath,['-e',"process.stderr.write('Address already in use');process.exit(1)"],{stdio:['ignore','pipe','pipe']});
  await assert.rejects(waitForServer(child),/code 1.*Address already in use/);
});
test('browser harness accepts readiness and times out a server that never becomes ready',async()=>{
  const ready=spawn(process.execPath,['-e',"process.stdout.write('Listening');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
  try{await waitForServer(ready);}finally{ready.kill();}
  const silent=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
  try{await assert.rejects(waitForServer(silent,{timeoutMs:100}),/did not listen/);}finally{silent.kill();}
});
