import {cp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const name=`omd-cloudflare-v${manifest.version}`,output=join(root,'release'),folder=join(output,name);
const sums=await readFile(join(output,'SHA256SUMS.txt'),'utf8');
await rm(folder,{recursive:true,force:true});await mkdir(folder,{recursive:true});
await cp(join(root,'dist-cloudflare','public'),join(folder,'public'),{recursive:true});
await cp(join(root,'dist-cloudflare','worker.js'),join(folder,'worker.js'));
await cp(join(root,'cloudflare','migrations'),join(folder,'migrations'),{recursive:true});
for(const [from,to]of [['deployment-package.json','package.json'],['deployment-package-lock.json','package-lock.json']]){
 const pkg=JSON.parse(await readFile(join(root,'cloudflare',from),'utf8'));pkg.version=manifest.version;if(pkg.packages)pkg.packages[''].version=manifest.version;
 if(from==='deployment-package.json'&&pkg.devDependencies.wrangler!==manifest.devDependencies.wrangler)throw new Error('Deployment Wrangler pin does not match the repository.');
 await writeFile(join(folder,to),JSON.stringify(pkg,null,2)+'\n');
}
const config=JSON.parse(await readFile(join(root,'cloudflare','wrangler.jsonc'),'utf8'));config.$schema='./node_modules/wrangler/config-schema.json';config.main='./worker.js';config.assets.directory='./public';
await writeFile(join(folder,'wrangler.jsonc'),JSON.stringify(config,null,2)+'\n');
await cp(join(root,'docs','cloudflare.md'),join(folder,'README.md'));
for(const file of ['DEPENDENCIES.json','THIRD_PARTY_NOTICES.txt','BUILD.json'])await cp(join(output,`omd-v${manifest.version}`,file),join(folder,file));
execFileSync('tar',['-czf',`${name}.tar.gz`,name],{cwd:output});execFileSync('zip',['-qr',`${name}.zip`,name],{cwd:output});
const added=[];for(const extension of ['zip','tar.gz']){const file=`${name}.${extension}`;added.push(`${createHash('sha256').update(await readFile(join(output,file))).digest('hex')}  ${file}`);}
const existing=sums.split('\n').filter(line=>line&&!line.endsWith(`${name}.zip`)&&!line.endsWith(`${name}.tar.gz`));
await writeFile(join(output,'SHA256SUMS.txt'),[...existing,...added].join('\n')+'\n');console.log(`Packaged ${name}: Worker, D1 migrations, frontend, deploy config, ZIP/tar.gz and checksums.`);
