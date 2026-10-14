/** A test must fail explicitly if its server cannot listen or exits before readiness. */
export function waitForServer(server,{timeoutMs=10000}={}){
  return new Promise((resolve,reject)=>{
    let stderr='';
    const capture=chunk=>{stderr=(stderr+chunk).slice(-4000);};
    const finish=error=>{clearTimeout(timer);server.stdout.off('data',ready);server.stderr?.off('data',capture);server.off('error',failed);server.off('exit',exited);error?reject(error):resolve();};
    const ready=()=>finish(),failed=error=>finish(error),exited=(code,signal)=>finish(new Error(`Test server exited before listening (code ${code}, signal ${signal}). ${stderr}`));
    const timer=setTimeout(()=>finish(new Error(`Test server did not listen within ${timeoutMs} ms. ${stderr}`)),timeoutMs);
    server.stderr?.on('data',capture);server.stdout.once('data',ready);server.once('error',failed);server.once('exit',exited);
    if(server.exitCode!==null||server.signalCode!==null)exited(server.exitCode,server.signalCode);
  });
}
