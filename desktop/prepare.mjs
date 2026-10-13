import {readFile,writeFile,cp,chmod,mkdir,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {customize} from './customize.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const work=join(root,'.desktop'),kit=join(work,'coconut-desktop-kit'),downloads=join(work,'downloads');
const settings=JSON.parse(await readFile(join(root,'desktop/orchard.json'),'utf8'));
const app=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
if(Number(process.versions.node.split('.')[0])<24)throw Error('Desktop builds require Node 24+.');
const npmCli=process.env.npm_execpath;if(!npmCli)throw Error('Run via npm run desktop:prepare.');
const run=(command,args,cwd=root)=>execFileSync(command,args,{cwd,stdio:'inherit'});
const npm=(args,cwd=root)=>run(process.execPath,[npmCli,...args],cwd);
const save=(path,value)=>writeFile(path,JSON.stringify(value,null,2)+'\n');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await mkdir(downloads,{recursive:true});
async function download(asset,url){
  const file=join(downloads,asset.file);
  let bytes;
  try{bytes=await readFile(file);}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!bytes){
    const response=await fetch(url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error(`Download ${asset.file}: HTTP ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    if(hash(bytes)!==asset.sha256)throw Error(`Checksum mismatch: ${asset.file}`);
    await writeFile(file,bytes);
  }
  if(hash(bytes)!==asset.sha256)throw Error(`Cached checksum mismatch: ${asset.file}; remove this cache file and retry.`);
  return file;
}
const releaseBase=`https://github.com/and1truong/orchad/releases/download/${settings.release}/`;
const kitArchive=await download(settings.assets.kit,releaseBase+settings.assets.kit.file);
await download(settings.assets.bridge,releaseBase+settings.assets.bridge.file);
await download(settings.assets.lime,releaseBase+settings.assets.lime.file);
const nodeArchive=settings.node.archives[`${process.platform}-${process.arch}`];
if(!nodeArchive)throw Error('Unsupported native desktop target.');
const nodeFile=await download(nodeArchive,`https://nodejs.org/dist/v${settings.node.version}/${nodeArchive.file}`);

// This directory is generated; notebook/agent data lives in the OS app-data profile.
await rm(kit,{recursive:true,force:true});
run('tar',['-xf',kitArchive,'-C',work]);
const provenance=JSON.parse(await readFile(join(kit,'orchard-release.json'),'utf8'));
if(provenance.revision!==settings.source||provenance.dirty)throw Error('Unexpected Orchard source provenance.');
await customize(kit);
await writeFile(join(kit,'trusted-origin.txt'),settings.origin+'\n');
await writeFile(join(kit,'mcp-port.txt'),String(settings.mcpPort)+'\n');
const tauriPath=join(kit,'src-tauri/tauri.conf.json'),tauri=JSON.parse(await readFile(tauriPath,'utf8'));
tauri.productName='OMD';tauri.version=app.version;tauri.identifier='dev.and1truong.omd';
tauri.app.windows[0]={...tauri.app.windows[0],title:'oh my day',width:1440,height:900,minWidth:960,minHeight:600};
tauri.build.beforeDevCommand='npm run build && npm run package:sidecar';
delete tauri.build.devUrl;
tauri.bundle.targets=process.platform==='win32'?['nsis']:process.platform==='darwin'?['dmg']:['deb'];
tauri.bundle.resources={'../host/sidecar.bundle.mjs':'host/sidecar.bundle.mjs','../omd/':'omd/','../runtime/':'runtime/'};
await save(tauriPath,tauri);
for(const path of ['src-tauri/Cargo.toml','src-tauri/Cargo.lock']){
  let text=await readFile(join(kit,path),'utf8');
  const old='name = "coconut"\nversion = "0.1.0"';
  if(!text.includes(old))throw Error(`Kit package identity changed: ${path}`);
  await writeFile(join(kit,path),text.replace(old,`name = "omd-desktop"\nversion = "${app.version}"`));
}
await cp(join(root,'desktop/native.rs'),join(kit,'src-tauri/src/omd.rs'));
await cp(join(root,'desktop/server.mjs'),join(kit,'host/omd-server.mjs'));
await cp(join(root,'desktop/sidecar.mjs'),join(kit,'host/omd-sidecar.mjs'));
const sidecarPath=join(kit,'scripts/package-sidecar.mjs');
let bundler=await readFile(sidecarPath,'utf8');
if(!bundler.includes("entryPoints:['host/sidecar.mjs']"))throw Error('Kit sidecar entry changed.');
await writeFile(sidecarPath,bundler.replace("entryPoints:['host/sidecar.mjs']","entryPoints:['host/omd-sidecar.mjs']"));
const extractedNode=join(work,'node-extract');await rm(extractedNode,{recursive:true,force:true});await mkdir(extractedNode);
run('tar',['-xf',nodeFile,'-C',extractedNode,'--strip-components=1']);
const runtime=join(kit,'runtime');await mkdir(runtime);
const executable=process.platform==='win32'?'node.exe':'node';
await cp(join(extractedNode,process.platform==='win32'?executable:'bin/node'),join(runtime,executable));
await cp(join(extractedNode,'LICENSE'),join(runtime,'NODE-LICENSE.txt'));
if(process.platform!=='win32')await chmod(join(runtime,executable),0o755);
await rm(extractedNode,{recursive:true,force:true});
await save(join(kit,'omd-desktop.json'),{version:app.version,orchard:settings.release,source:settings.source,node:settings.node.version,origin:settings.origin,mcpPort:settings.mcpPort});
npm(['run','build']);
await cp(join(root,'dist'),join(kit,'omd'),{recursive:true});
npm(['ci','--no-audit','--no-fund'],kit);
npm(['run','tauri','--','icon',join(root,'icons/icon-512.png'),'--output',join(kit,'src-tauri/icons')],kit);
tauri.bundle.icon=['icons/32x32.png','icons/128x128.png','icons/128x128@2x.png','icons/icon.icns','icons/icon.ico'];
await save(tauriPath,tauri);
npm(['run','build'],kit);npm(['run','package:sidecar'],kit);
console.log(`Prepared OMD Desktop from ${settings.release}; bundled Node ${settings.node.version}.`);
