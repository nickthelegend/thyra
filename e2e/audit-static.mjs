/** A real static file host for client error tests; no API routes or response interception. */
import { createServer } from 'node:http';
import { readFileSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve,extname } from 'node:path';
const dir=resolve(fileURLToPath(new URL('../packages/landing',import.meta.url)));
createServer((req,res)=>{
 res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,DELETE,OPTIONS');
 if(req.method==='OPTIONS')return void res.writeHead(204).end();let pathname=new URL(req.url??'/','http://x').pathname;if(pathname.endsWith('/'))pathname+='index.html';
 const path=resolve(dir,'.'+pathname);if(!path.startsWith(dir+'/')||!existsSync(path))return void res.writeHead(404,{'Content-Type':'text/plain'}).end('not found');res.writeHead(200,{'Content-Type':extname(path)==='.html'?'text/html':'application/octet-stream'}).end(readFileSync(path));
}).listen(8431,'127.0.0.1');
