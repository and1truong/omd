import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url));
export const cli=join(root,'node_modules/wrangler/bin/wrangler.js');
export async function startCloudflare({cwd=root,config=join(root,'cloudflare/wrangler.jsonc'),state}={}){
  const temporary=await mkdtemp(join(tmpdir(),'omd cloud ')),persist=state??join(temporary,'state');
  const env={...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(temporary,'wrangler.log'),XDG_CONFIG_HOME:join(temporary,'config')};
  const args=['--config',config,'--persist-to',persist];
  const run=(extra)=>execFileSync(process.execPath,[cli,...extra],{cwd,env,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  run(['d1','migrations','apply','omd-notebook',...args,'--local']);
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  const server=spawn(process.execPath,[cli,'dev','--config',config,'--persist-to',persist,'--local','--ip','127.0.0.1','--port',String(port),'--inspector-port','0'],{cwd,env,stdio:['ignore','pipe','pipe']});
  let output='';for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{output=(output+data).slice(-100000);});
  const url=`http://127.0.0.1:${port}`;
  try{const deadline=Date.now()+30000;for(;;){if(server.exitCode!==null)throw new Error(`Worker exited: ${output}`);try{if((await fetch(url)).ok)break;}catch{}if(Date.now()>deadline)throw new Error(`Worker startup timeout: ${output}`);await new Promise(resolve=>setTimeout(resolve,100));}}
  catch(error){server.kill();await rm(temporary,{recursive:true,force:true});throw error;}
  return {url,state:persist,
    sql(command){const result=run(['d1','execute','omd-notebook',...args,'--local','--command',command,'--json']);return JSON.parse(result)[0].results;},
    async stop(){if(server.exitCode===null){const done=new Promise(resolve=>server.once('exit',resolve));server.kill();await done;}await rm(temporary,{recursive:true,force:true});}
  };
}
