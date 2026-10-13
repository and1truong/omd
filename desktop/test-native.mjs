// Debug-only driver through Coconut's actual native dispatch/approval path, plus real MCP HTTP.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {connect} from 'node:net';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
const kit=join(root,'.desktop/coconut-desktop-kit');
const {Client}=await import(new URL('../.desktop/coconut-desktop-kit/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js',import.meta.url));
const {StreamableHTTPClientTransport}=await import(new URL('../.desktop/coconut-desktop-kit/node_modules/@modelcontextprotocol/sdk/dist/esm/client/streamableHttp.js',import.meta.url));
const bin=process.argv[2]??join(root,'.desktop/target/debug/omd-desktop'+(process.platform==='win32'?'.exe':''));
await access(bin);
const profile=await mkdtemp(join(tmpdir(),'omd-native-profile-'));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function waitFor(fn,ms=60000){const until=Date.now()+ms;for(;;){const value=await fn();if(value)return value;if(Date.now()>until)throw Error('Native acceptance timed out');await sleep(200);}}
function smoke(op,extra={}){return new Promise((resolve,reject)=>{
  const socket=connect(4319,'127.0.0.1');let data='';
  const timer=setTimeout(()=>{socket.destroy();reject(Error('Native smoke timeout: '+op));},65000);
  const fail=e=>{clearTimeout(timer);socket.destroy();reject(e);};socket.on('error',fail);
  socket.on('end',()=>fail(Error('Native smoke closed: '+op)));
  socket.on('connect',()=>socket.write(JSON.stringify({op,...extra})+'\n'));
  socket.on('data',chunk=>{data+=chunk;if(!data.includes('\n'))return;clearTimeout(timer);socket.destroy();try{const result=JSON.parse(data.split('\n')[0]);result.ok?resolve(result.result):reject(Error(result.error));}catch(e){reject(e);}});
});}
const request=request=>smoke('request',{request});
const tool=(tool,args)=>request({action:'tool',tool,args});
let child,stderr='',client,beat;
async function start(){
  stderr='';child=spawn(bin,[],{cwd:kit,stdio:['ignore','ignore','pipe'],env:{...process.env,COCONUT_SMOKE:'1',COCONUT_GATEWAY_URL:'',COCONUT_GATEWAY_TOKEN:'',COCONUT_GATEWAY_MODEL:'',XDG_DATA_HOME:profile,WEBKIT_DISABLE_DMABUF_RENDERER:'1',WEBKIT_DISABLE_COMPOSITING_MODE:'1',LIBGL_ALWAYS_SOFTWARE:'1'}});
  child.stderr.on('data',d=>stderr+=d);child.on('error',e=>stderr+=e.message);
  const target=await waitFor(async()=>{if(child.exitCode!==null)throw Error('Native exited: '+stderr.slice(-3000));return await request({action:'heartbeat'}).then(s=>s.targets.find(t=>t.appId==='omd'),()=>false);});
  beat=setInterval(()=>request({action:'heartbeat'}).catch(()=>{}),1000);
  await waitFor(()=>stderr.includes('COCONUT_SMOKE:ui-response:consent'));
  return target;
}
async function close(){
  const exited=new Promise(r=>child.once('exit',r));
  // A correlated getContext flush drives the actual CloseRequested path.
  await smoke('close').catch(e=>{if(!/closed/.test(e.message))throw e;});
  await Promise.race([exited,sleep(15000).then(()=>{throw Error('Save-before-close did not finish');})]);
  clearInterval(beat);beat=null;
  await waitFor(async()=>!(await fetch('http://127.0.0.1:33181').then(()=>true,()=>false)),10000);
  assert.equal(await fetch('http://127.0.0.1:33182/mcp').then(()=>true,()=>false),false);
}
try{
  let target=await start();
  const layout=await smoke('layout');
  assert.equal(layout.guest.width+layout.host.width,layout.window.width);
  assert.equal(layout.guest.height,layout.window.height);
  assert.equal(layout.host.height,layout.window.height);
  assert.equal((await fetch('http://127.0.0.1:33182/mcp')).status,401);
  const description=await tool('host_list_tools',target);assert.equal(description.ok,true);assert(description.data.tools.some(t=>t.name==='omd_add_block'));
  const context=(await tool('host_get_context',target)).data;
  const paired=await request({action:'pair',name:'OMD acceptance',scopes:['read','write'],targetIds:[target.targetId],readTools:'all'});
  client=new Client({name:'omd-acceptance',version:'1.0.0'});
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:33182/mcp'),{requestInit:{headers:{Authorization:'Bearer '+paired.token}}}));
  const mcp=async(name,args)=>(await client.callTool({name,arguments:args})).structuredContent;
  assert.equal((await mcp('host_get_context',target)).data.documentId,context.documentId);
  const call={requestId:crypto.randomUUID(),documentId:context.documentId,toolName:'omd_add_block',arguments:{pageId:context.selectionIds[0],type:'text',text:'Native durable bridge'},expectedRevision:context.revision,idempotencyKey:crypto.randomUUID()};
  async function decide(call,allow=true){
    const pending=mcp('host_call_tool',{...target,call});pending.catch(()=>{});
    const card=await waitFor(async()=> (await request({action:'heartbeat'})).approvals.find(a=>a.call.requestId===call.requestId),15000);
    await request({action:'decide',approvalId:card.id,allow});return pending;
  }
  const denied=await decide({...call,requestId:crypto.randomUUID()},false);assert.equal(denied.error.code,'APPROVAL_DENIED');
  const one=await decide(call);assert.equal(one.ok,true);assert.equal(one.revision,context.revision+1);
  assert.deepEqual(await decide({...call,requestId:crypto.randomUUID()}),one);
  assert.equal((await decide({...call,requestId:crypto.randomUUID(),arguments:{...call.arguments,text:'Conflict'}})).error.code,'IDEMPOTENCY_CONFLICT');
  assert.equal((await decide({...call,requestId:crypto.randomUUID(),idempotencyKey:crypto.randomUUID()})).error.code,'STALE_CONTEXT');
  await client.close();client=null;await close();target=await start();
  assert.equal((await tool('host_get_context',target)).data.revision,one.revision);
  await tool('host_list_tools',target);await request({action:'consent',targetId:target.targetId,readTools:['omd_get_block']});
  const read=await tool('host_call_tool',{...target,call:{requestId:crypto.randomUUID(),documentId:context.documentId,toolName:'omd_get_block',arguments:{pageId:call.arguments.pageId,blockId:one.data.blockId},expectedRevision:null,idempotencyKey:null}});
  assert.equal(read.ok,true);assert.equal(read.data.block.text,'Native durable bridge');
  const replay=tool('host_call_tool',{...target,call:{...call,requestId:crypto.randomUUID()}});replay.catch(()=>{});
  const card=await waitFor(async()=> (await request({action:'heartbeat'})).approvals[0],15000);await request({action:'decide',approvalId:card.id,allow:true});assert.deepEqual(await replay,one);
  await smoke('stop_sidecar');await waitFor(()=>stderr.includes('COCONUT_SMOKE:recv:eof'));
  await assert.rejects(request({action:'heartbeat'}),/disconnected/i);
  await close();console.log('OMD native acceptance passed: real WebView, MCP, approvals, retry/conflict/stale, restart, service failure and sidecar cleanup.');
}catch(e){console.error(stderr.slice(-5000));throw e;}
finally{clearInterval(beat);await client?.close().catch(()=>{});if(child&&child.exitCode===null){await smoke('quit').catch(()=>{});child.kill('SIGKILL');}await rm(profile,{recursive:true,force:true});}
