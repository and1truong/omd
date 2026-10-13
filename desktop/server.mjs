import http from 'node:http';
import {readFile,realpath,stat} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';

const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.wasm':'application/wasm'};
export async function startServer(directory,origin){
  const root=await realpath(directory),url=new URL(origin);
  if(url.hostname!=='127.0.0.1'||url.protocol!=='http:'||url.pathname!=='/'||url.username||url.password||url.search||url.hash||!url.port)throw Error('Desktop assets require a fixed bare loopback origin.');
  const server=http.createServer(async(req,res)=>{
    if(req.headers.host!==url.host){res.writeHead(421);res.end('Invalid host');return;}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
    try{
      const requested=new URL(req.url,origin);
      const route=/^\/page(?:\/[^/]*)?\/?$/.test(requested.pathname);
      const path=decodeURIComponent(requested.pathname);
      const file=await realpath(resolve(root,route?'index.html':'.'+(path.endsWith('/')?path+'index.html':path)));
      if(!file.startsWith(root+sep)){res.writeHead(403);res.end();return;}
      const info=await stat(file);if(!info.isFile())throw Error('Not a file');
      const data=await readFile(file);
      res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Content-Length':data.length,'Cache-Control':'no-cache','Content-Security-Policy':"frame-ancestors 'none'; object-src 'none'",'X-Content-Type-Options':'nosniff'});
      res.end(req.method==='HEAD'?undefined:data);
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(url.port),'127.0.0.1',resolve);});
  return server;
}
