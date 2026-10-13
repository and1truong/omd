// Run an installed Linux package in an isolated profile, without source/node_modules.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {connect} from 'node:net';
const bin=process.argv[2];if(!bin)throw Error('Pass the installed release binary.');
assert.match(execFileSync(bin,['--version'],{encoding:'utf8'}),/^omd /);
const profile=await mkdtemp(join(tmpdir(),'omd-installed-'));
let stderr='';const child=spawn(bin,[],{cwd:profile,env:{...process.env,XDG_DATA_HOME:profile,COCONUT_SMOKE:'1',COCONUT_GATEWAY_URL:'',COCONUT_GATEWAY_TOKEN:'',COCONUT_GATEWAY_MODEL:'',WEBKIT_DISABLE_DMABUF_RENDERER:'1',WEBKIT_DISABLE_COMPOSITING_MODE:'1',LIBGL_ALWAYS_SOFTWARE:'1'},stdio:['ignore','ignore','pipe']});
child.stderr.on('data',d=>stderr+=d);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
try{
  const until=Date.now()+60000;let page;
  for(;;){
    if(child.exitCode!==null)throw Error('Installed app exited: '+stderr);
    page=await fetch('http://127.0.0.1:33181/').catch(()=>null);if(page?.ok)break;
    if(Date.now()>until)throw Error('Installed assets did not start: '+stderr);await sleep(200);
  }
  assert.match(await page.text(),/oh my day/i);
  assert.equal((await fetch('http://127.0.0.1:33181/src/bridge-engine.js')).status,200);
  assert.equal((await fetch('http://127.0.0.1:33182/mcp')).status,401);
  const debugPort=await new Promise(resolve=>{const socket=connect(4319,'127.0.0.1');socket.setTimeout(2000);socket.on('connect',()=>{socket.destroy();resolve(true);});socket.on('error',()=>resolve(false));socket.on('timeout',()=>{socket.destroy();resolve(false);});});
  assert.equal(debugPort,false,'Release must not expose the debug driver');
  const exited=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await exited;await sleep(500);
  for(const port of [33181,33182])assert.equal(await fetch(`http://127.0.0.1:${port}/`).then(()=>true,()=>false),false);
  console.log('Installed Linux package passed: bundled runtime/assets/MCP, no debug driver, process cleanup.');
}finally{if(child.exitCode===null)child.kill('SIGKILL');await rm(profile,{recursive:true,force:true});}
