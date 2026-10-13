import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

// Version-pinned integration seams. A changed upstream anchor must fail, not silently fork policy.
export async function customize(kit){
  const edit=async(path,changes)=>{
    let source=await readFile(join(kit,path),'utf8');
    for(const [before,after] of changes){
      if(source.split(before).length!==2)throw Error(`Orchard integration anchor changed: ${path}: ${before.slice(0,80)}`);
      source=source.replace(before,after);
    }
    await writeFile(join(kit,path),source);
  };
  await edit('src-tauri/src/main.rs',[
    ['#[derive(Default)]','mod omd;\n#[derive(Default)]'],
    ['setup(move |app|{','setup(move |app|{omd::layout(app.handle())?;'],
    ['    target: Mutex<Option<Value>>,','    target: Mutex<Option<Value>>,\n    omd_close: Mutex<Option<String>>,\n    omd_allow_close: AtomicBool,'],
    ['    // Rebind without navigation:','    if omd::close_reply(&webview, &state, &id, &result) { return Ok(()); }\n    // Rebind without navigation:'],
    ['tauri::LogicalPosition::new(0.0, 70.0),','tauri::LogicalPosition::new(0.0, 0.0),'],
    ['tauri::LogicalSize::new(760.0, 730.0),','omd::guest_size(&window)?,'],
    ['println!("coconut {}",','println!("omd {}",'],
    ['let path=if cfg!(debug_assertions){std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../host/sidecar.mjs")}else{app.path().resource_dir()?.join("_up_/host/sidecar.bundle.mjs")};let mut child=Command::new("node").arg(path)',
     'let (base,node)=omd::runtime(app.handle())?;let mut child=Command::new(node).arg(base.join("host/sidecar.bundle.mjs")).env("OMD_ASSET_DIR",base.join("omd")).env("OMD_ORIGIN",TRUSTED_APP_ORIGIN).env("COCONUT_MCP_PORT",include_str!("../../mcp-port.txt").trim()).env("COCONUT_DURABLE_DB",app.path().app_data_dir()?.join("agent-runs.db"))'],
    ['match m["kind"].as_str(){Some("response")','match m["kind"].as_str(){Some("ready")=>omd::ready(&handle),Some("response")'],
    ['if m["operation"]=="invoke" && !handle.get_window("host").is_some_and(|w|w.is_visible().unwrap_or(false)&&!w.is_minimized().unwrap_or(true))',
     'if m["operation"]=="invoke" && (lock(&s.omd_close).is_some() || !handle.get_window("host").is_some_and(|w|w.is_visible().unwrap_or(false)&&!w.is_minimized().unwrap_or(true)))'],
    ['Some("quit")=>{','Some("close")=>h.get_window("host").ok_or_else(||"Host missing".to_string()).and_then(|w|w.close().map_err(|e|e.to_string())).map(|_|json!(true)),Some("quit")=>{'],
    ['Some("ping")=>Ok(json!(true)),','Some("ping")=>Ok(json!(true)),Some("layout")=>(||{let window=h.get_window("host").ok_or("Host missing")?.inner_size().map_err(|e|e.to_string())?;let host=h.get_webview("host").ok_or("Host missing")?.size().map_err(|e|e.to_string())?;let guest=h.get_webview("guest").ok_or("Guest missing")?.size().map_err(|e|e.to_string())?;Ok(json!({"window":window,"host":host,"guest":guest}))})(),'],
    ['invalidate(&handle.state::<Arc<Native>>());for(_,tx)', 'omd::disconnected(&handle);for(_,tx)'],
    ['Some("close")=>', 'Some("stop_sidecar")=>{let s=h.state::<Arc<Native>>();let result=lock(&s.child).as_mut().ok_or_else(||"Sidecar missing".to_string()).and_then(|c|c.kill().map_err(|e|e.to_string()));result.map(|_|json!(true))},Some("close")=>'],
    ['.on_window_event(|window,event|{if matches!','.on_window_event(|window,event|{omd::window_event(window,event);if matches!']
  ]);
  await edit('src/main.tsx',[
    ["const log=(x:any)=>setTranscript(t=>[...t,typeof x==='string'?x:JSON.stringify(x)]);", "const log=(x:any)=>setTranscript(t=>[...t,typeof x==='string'?x:JSON.stringify(x)]);const [closeError,setCloseError]=useState('');\n useEffect(()=>{const un=listen<string>('omd-close-error',e=>setCloseError(e.payload));return()=>{un.then(f=>f());};},[]);\n useEffect(()=>{if(closeError)document.querySelector('aside')?.scrollTo(0,0);},[closeError]);\n useEffect(()=>{if(target?.appId)return;const timer=setInterval(()=>{invoke('discover_guest').catch(()=>{});},1000);return()=>clearInterval(timer);},[target?.appId]);"],
    ["[prompt,setPrompt]=useState('Increment by one')","[prompt,setPrompt]=useState('Help me plan my day')"],
    ["[dPrompt,setDPrompt]=useState('Increment the counter by one')","[dPrompt,setDPrompt]=useState('Help me plan my day')"],
    ['return <><header><b>Coconut</b><input value={url}','return <><header><b>oh my day</b></header><div hidden><input value={url}'],
    ['</button></header><aside><h2>Trusted agent sidebar</h2><p>Development · Bridge 0.1</p>','</button></div><aside>{closeError&&<p role="alert">{closeError}</p>}<h2>Agent</h2>']
  ]);
  await edit('src/style.css',[
    ['body{margin:0;','body{color-scheme:dark;margin:0;'],
    ['header{height:70px;display:flex;align-items:center;gap:12px;padding:16px}header input{flex:1}aside{position:absolute;left:770px;right:0;top:70px;bottom:0;',
     'header{position:absolute;right:0;top:0;width:360px;min-height:48px;padding:12px}aside{position:absolute;width:360px;right:0;top:48px;bottom:0;']
  ]);
}
