import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {collectDesktopRelease} from '../scripts/collect-desktop-release.mjs';

test('publication requires matching installers, provenance and Lime bytes from every platform',async()=>{
  const root=await mkdtemp(join(tmpdir(),'omd-release-assets-'));
  const output=join(root,'release'),artifacts=join(root,'artifacts'),version='0.1.0',commit='a'.repeat(40);
  const hash=value=>createHash('sha256').update(value).digest('hex');
  const pins={release:'orchard-v0.1.0',source:'b'.repeat(40),node:{version:'24.19.0'},origin:'http://127.0.0.1:33181',mcpPort:33182,assets:{lime:{file:'lime.zip',sha256:hash('verified lime')}}};
  const metadata={version,orchard:pins.release,source:pins.source,node:pins.node.version,origin:pins.origin,mcpPort:pins.mcpPort};
  try{
    await mkdir(output);const sums=[];
    for(const extension of ['zip','tar.gz']){const name=`omd-v${version}.${extension}`;await writeFile(join(output,name),'verified web '+extension);sums.push(`${hash('verified web '+extension)}  ${name}\n`);}
    await writeFile(join(output,'SHA256SUMS.txt'),sums.join(''));
    for(const [platform,extension] of [['Linux','deb'],['macOS','dmg'],['Windows','exe']]){
      const dir=join(artifacts,`omd-desktop-${platform}`,'nested');await mkdir(dir,{recursive:true});
      await writeFile(join(dir,`OMD_${version}_x64.${extension}`),platform+' installer');
      await writeFile(join(dir,'omd-desktop.json'),JSON.stringify(metadata));await writeFile(join(dir,'lime.zip'),'verified lime');
    }
    const options={artifacts,output,version,pins,commit};
    const windows=join(artifacts,'omd-desktop-Windows/nested');
    await writeFile(join(windows,'omd-desktop.json'),JSON.stringify({...metadata,version:'0.0.4'}));
    await assert.rejects(collectDesktopRelease(options),/provenance mismatch/);assert.equal((await readdir(output)).length,3,'No partial installer set on failure');
    await writeFile(join(windows,'omd-desktop.json'),JSON.stringify(metadata));await writeFile(join(windows,'lime.zip'),'tampered lime');
    await assert.rejects(collectDesktopRelease(options),/Lime checksum mismatch/);assert.equal((await readdir(output)).length,3);
    await writeFile(join(windows,'lime.zip'),'verified lime');
    const assets=await collectDesktopRelease(options);assert.equal(assets.length,7);
    const manifest=JSON.parse(await readFile(join(output,'omd-desktop-builds.json'),'utf8'));assert.equal(manifest.commit,commit);assert.equal(manifest.builds.length,3);
    for(const line of (await readFile(join(output,'SHA256SUMS.txt'),'utf8')).trim().split('\n')){const [digest,name]=line.split('  ');assert.equal(hash(await readFile(join(output,name))),digest);}
    assert.equal(assets.filter(name=>name==='lime.zip').length,1);
  }finally{await rm(root,{recursive:true,force:true});}
});
