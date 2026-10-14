import {readFile,writeFile,readdir,cp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join,basename,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
async function files(directory){
  const result=[];
  for(const item of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,item.name);
    if(item.isDirectory())result.push(...await files(path));else if(item.isFile())result.push(path);
  }
  return result;
}

export async function collectDesktopRelease({artifacts,output,version,pins,commit}){
  if(!/^\d+\.\d+\.\d+$/.test(version)||!/^[a-f0-9]{40}$/.test(commit))throw Error('Invalid release identity.');
  const sums=await readFile(join(output,'SHA256SUMS.txt'),'utf8');
  const entries=new Map();
  for(const line of sums.trim().split('\n')){
    const match=/^([a-f0-9]{64})  ([A-Za-z0-9][A-Za-z0-9._-]*)$/.exec(line);
    if(!match||entries.has(match[2]))throw Error('Invalid web checksums.');
    if(digest(await readFile(join(output,match[2])))!==match[1])throw Error('Web checksum mismatch.');
    entries.set(match[2],match[1]);
  }
  for(const extension of ['zip','tar.gz']){if(!entries.has(`omd-v${version}.${extension}`))throw Error('Missing versioned web archive.');if(!entries.has(`omd-cloudflare-v${version}.${extension}`))throw Error('Missing versioned Cloudflare archive.');}
  const builds=[],copies=[];
  for(const [platform,extension] of [['Linux','.deb'],['macOS','.dmg'],['Windows','.exe']]){
    const paths=await files(join(artifacts,`omd-desktop-${platform}`));
    const installers=paths.filter(path=>path.endsWith(extension));
    const provenance=paths.filter(path=>basename(path)==='omd-desktop.json');
    const lime=paths.filter(path=>basename(path)===pins.assets.lime.file);
    if(installers.length!==1||provenance.length!==1||lime.length!==1)throw Error(`Incomplete ${platform} artifacts.`);
    const name=basename(installers[0]);
    if(!name.startsWith(`OMD_${version}_`)||!/^[A-Za-z0-9._-]+$/.test(name)||entries.has(name))throw Error(`Wrong/duplicate ${platform} installer version.`);
    const metadata=JSON.parse(await readFile(provenance[0],'utf8'));
    for(const [key,value] of Object.entries({version,orchard:pins.release,source:pins.source,node:pins.node.version,origin:pins.origin,mcpPort:pins.mcpPort}))if(metadata[key]!==value)throw Error(`${platform} provenance mismatch: ${key}`);
    if(digest(await readFile(lime[0]))!==pins.assets.lime.sha256)throw Error(`${platform} Lime checksum mismatch.`);
    const sha256=digest(await readFile(installers[0]));
    entries.set(name,sha256);copies.push([installers[0],name]);
    builds.push({platform,installer:name,sha256,...metadata});
    if(platform==='Linux')copies.push([lime[0],pins.assets.lime.file]);
  }
  // Validate ALL platform inputs before touching the publication directory.
  for(const [path,name] of copies)await cp(path,join(output,name));
  entries.set(pins.assets.lime.file,pins.assets.lime.sha256);
  const manifest='omd-desktop-builds.json';
  const bytes=JSON.stringify({version,commit,builds},null,2)+'\n';
  await writeFile(join(output,manifest),bytes);entries.set(manifest,digest(bytes));
  await writeFile(join(output,'SHA256SUMS.txt'),[...entries].sort(([a],[b])=>a.localeCompare(b)).map(([name,hash])=>`${hash}  ${name}\n`).join(''));
  return [...entries.keys()];
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {version}=JSON.parse(await readFile('package.json','utf8'));
  const pins=JSON.parse(await readFile('desktop/orchard.json','utf8'));
  const assets=await collectDesktopRelease({artifacts:'desktop-artifacts',output:'release',version,pins,commit:process.env.GITHUB_SHA});
  console.log(`Verified ${assets.length} release assets, including all three desktop installers.`);
}
