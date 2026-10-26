import { spawn } from 'node:child_process';
/** Real non-JSON static-host errors and a genuinely suspended gateway, no fake transport. */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, evalPage, sleep } from './iwsdk.ts';
const out=process.env.THYRA_AUDIT_DIR!,root=fileURLToPath(new URL('../',import.meta.url));
const checks:Array<{id:string;ok:boolean;detail?:unknown}>=[];const check=(id:string,ok:boolean,detail?:unknown)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
const server=spawn(process.execPath,[`${root}e2e/audit-static.mjs`],{stdio:'ignore'});await sleep(500);const pid=Number(readFileSync('/tmp/thyra-t5-gateway.pid','utf8'));let suspended=false;
try {
 writeFileSync('/tmp/thyra-t5-stage','client-non-json-expected');
 evalPage(`(location.search='?gateway=http://127.0.0.1:8431////',true)`);await sleep(3500);
 const nonjson=evalPage<any>(`(async()=>{const {gateway,GatewayError}=await import('/src/gateway-client.ts');try{await gateway.createRun({},'audit','cc0-sample',null);}catch(e){return {instance:e instanceof GatewayError,status:e.status,body:e.body,base:gateway.base,image:gateway.imageUrl('/api/image')};}})()`);
 check('G19-non-json',nonjson.instance&&nonjson.status===404&&nonjson.body.error==='bad_response'&&nonjson.body.message==='not found',nonjson);
 check('A13-query-base',nonjson.base==='http://127.0.0.1:8431'&&nonjson.image==='http://127.0.0.1:8431/api/image',nonjson);
 writeFileSync('/tmp/thyra-t5-stage','client-json-expected');evalPage(`(location.search='',true)`);await sleep(3500);
 const json=evalPage<any>(`(async()=>{const {gateway,GatewayError}=await import('/src/gateway-client.ts');try{await gateway.plan({},'audit');}catch(e){return {instance:e instanceof GatewayError,status:e.status,body:e.body,setup:e.setupRequired};}})()`);
 check('G19-json',json.instance&&json.status===503&&json.setup&&json.body.error==='setup_required',json);
 writeFileSync('/tmp/thyra-t5-stage','client-timeout-expected');process.kill(pid,'SIGSTOP');suspended=true;
 const status=evalPage<any>(`(async()=>{const {gateway}=await import('/src/gateway-client.ts');const t=performance.now();return {result:await gateway.status(),ms:performance.now()-t};})()`,15000);
 check('G19-status-timeout',status.result===null&&status.ms>=3950&&status.ms<6000,status);
 // Start the real 130s request, then sample the settled promise via short browser leases.
 evalPage(`(() => {window.__auditCall=null;const t=performance.now();import('/src/gateway-client.ts').then(({gateway})=>gateway.createRun({},'audit','cc0-sample',null)).then(v=>window.__auditCall={ok:true,value:v,ms:performance.now()-t},e=>window.__auditCall={ok:false,name:e.name,ms:performance.now()-t});return true;})()`);
 let result:any=null;for(let i=0;i<150;i++){result=evalPage('window.__auditCall');if(result)break;await sleep(1000);}
 check('G19-ordinary-timeout',result?.ok===false&&result.name==='TimeoutError'&&result.ms>=129900&&result.ms<132000,result);
} catch(e){check('client-completed',false,(e as Error).message);} finally {if(suspended)process.kill(pid,'SIGCONT');if(server.pid)process.kill(server.pid,'SIGTERM');writeFileSync('/tmp/thyra-t5-stage','client-restored');}
writeFileSync(`${out}/client.json`,JSON.stringify({at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));process.exitCode=checks.some(c=>!c.ok)?1:0;
