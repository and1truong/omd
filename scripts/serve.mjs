import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(fileURLToPath(new URL('..', import.meta.url)), process.env.OMD_STATIC_DIR || '.');
const basePath=(process.env.OMD_BASE_PATH??'').replace(/\/$/,'');
if(basePath&&!/^\/[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(basePath))throw new Error('Invalid static base path.');
const port = Number(process.env.OMD_PORT || 3000);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2':'font/woff2', '.woff':'font/woff', '.ttf':'font/ttf' };
http.createServer(async (req, res) => {
  try {
    const requested=new URL(req.url,'http://localhost');let path=decodeURIComponent(requested.pathname);
    if(basePath){if(path===basePath){res.writeHead(302,{Location:basePath+'/'+requested.search});res.end();return;}if(!path.startsWith(basePath+'/')){res.writeHead(404);res.end('Not found');return;}path=path.slice(basePath.length);}
    const destination=req.headers['sec-fetch-dest'];
    const route=(!destination||destination==='document'||destination==='empty')&&/^\/page(?:\/[^/]*)?\/?$/.test(requested.pathname.slice(basePath.length));
    const file = resolve(root, route?'index.html':`.${path.endsWith('/') ? path + 'index.html' : path}`);
    if (!file.startsWith(root + sep)) { res.writeHead(403); res.end(); return; }
    if (!(await stat(file)).isFile()) throw new Error('Not a file');
    const data = await readFile(file); res.writeHead(200, { 'Content-Type': `${mime[extname(file)] ?? 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-cache' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`omd: http://localhost:${port}`));
