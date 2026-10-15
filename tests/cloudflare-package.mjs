import assert from 'node:assert/strict';
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {startCloudflare,cli} from './cloudflare-helper.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8')),name=`omd-cloudflare-v${manifest.version}`;
const sums=await readFile(join(root,'release/SHA256SUMS.txt'),'utf8');
for(const extension of ['zip','tar.gz']){
  const file=`${name}.${extension}`,archive=join(root,'release',file),bytes=await readFile(archive);assert.ok(sums.includes(`${createHash('sha256').update(bytes).digest('hex')}  ${file}\n`));
  const temp=await mkdtemp(join(tmpdir(),'omd cloud package '));let worker;
  try{
    execFileSync(extension==='zip'?'unzip':'tar',extension==='zip'?['-q',archive,'-d',temp]:['-xzf',archive,'-C',temp]);
    const folder=join(temp,name),pkg=JSON.parse(await readFile(join(folder,'package.json'),'utf8')),lock=JSON.parse(await readFile(join(folder,'package-lock.json'),'utf8')),build=JSON.parse(await readFile(join(folder,'BUILD.json'),'utf8')),config=JSON.parse(await readFile(join(folder,'wrangler.jsonc'),'utf8'));
    assert.equal(pkg.version,manifest.version);assert.equal(lock.version,manifest.version);assert.equal(lock.packages[''].version,manifest.version);assert.equal(pkg.devDependencies.wrangler,manifest.devDependencies.wrangler);assert.equal(lock.packages['node_modules/wrangler'].version,pkg.devDependencies.wrangler);assert.equal(build.version,manifest.version);assert.match(build.commit,/^[a-f0-9]{40}$/);
    assert.equal(config.main,'./worker.js');assert.equal(config.assets.directory,'./public');assert.equal(config.assets.binding,'ASSETS');assert.equal(config.d1_databases[0].binding,'DB');assert.equal(config.d1_databases[0].database_id,'00000000-0000-0000-0000-000000000000');
    async function files(directory,prefix=''){const out=[];for(const item of await readdir(directory,{withFileTypes:true})){assert.notEqual(item.name,'node_modules');const path=prefix+item.name;if(item.isDirectory())out.push(...await files(join(directory,item.name),path+'/'));else out.push(path);}return out.sort();}
    const assets=await files(join(folder,'public'));assert.deepEqual(assets,await files(join(root,'dist-cloudflare/public')));assert.ok((await readFile(join(folder,'worker.js'),'utf8')).includes('Another device'));assert.ok((await readFile(join(folder,'migrations/0001_notebook.sql'),'utf8')).includes('CREATE TABLE notebook'));
    execFileSync(process.execPath,[cli,'deploy','--config',join(folder,'wrangler.jsonc'),'--dry-run','--outdir',join(temp,'upload')],{cwd:folder,env:{...process.env,WRANGLER_SEND_METRICS:'false',WRANGLER_LOG_PATH:join(temp,'wrangler.log'),XDG_CONFIG_HOME:join(temp,'config')},stdio:['ignore','pipe','pipe']});
    worker=await startCloudflare({cwd:folder,config:join(folder,'wrangler.jsonc')});
    const rpc=async operation=>(await(await fetch(worker.url+'/api/notebook',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation,session:'package-verification'})})).json()).result;
    assert.equal((await rpc('read')).meta.pages[0].title,'Shared notebook');assert.equal((await rpc('export')).pages.length,1);
    assert.equal((await fetch(worker.url+'/src/runtime.js')).status,200);assert.equal((await fetch(worker.url+'/missing-script.js')).status,404);assert.equal((await fetch(worker.url+'/page/preview')).status,200);
    for(let i=0;i<assets.length;i+=16)await Promise.all(assets.slice(i,i+16).map(async file=>{const response=await fetch(worker.url+'/'+file);assert.equal(response.status,200,file);assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(join(folder,'public',file)),file);}));
    console.log(`${file}: extracted standalone Worker/D1, deployment dry-run, migrations, pinned Wrangler and ${assets.length} frontend assets passed.`);
  }finally{await worker?.stop();await rm(temp,{recursive:true,force:true});}
}
