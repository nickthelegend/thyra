import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODELS } from '../packages/gateway/src/config.ts';
const require=createRequire(new URL('../packages/xr/package.json',import.meta.url));
const { chromium }=require('playwright');
const root=resolve(fileURLToPath(new URL('../',import.meta.url))),dir='/tmp/thyra-t5-audit-runs';
const checks=[],events=[];
const check=(id,ok,detail)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
const browser=await chromium.launch({headless:true});const ctx=await browser.newContext();
const api=ctx.request;
const room=JSON.parse(readFileSync(`${root}/packages/landing/data/schedule.json`)).summary;
let created;
async function req(path,method='GET',data,expected=200,headers={}) {
 const r=await api.fetch(`http://127.0.0.1:8430${path}`,{method,...(data===undefined?{}:{data,headers:{'Content-Type':'application/json',...headers}}),headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),...headers}});
 const text=await r.text();let body;try{body=JSON.parse(text);}catch{body=text;}
 events.push({at:new Date().toISOString(),path,method,status:r.status(),expected,headers:r.headers(),body});
 if(r.status()!==expected)throw Error(`${path} ${method}: ${r.status()} expected ${expected}`);
 return body;
}
try {
 const s=await req('/api/status');check('G01',s.service==='thyra-gateway'&&s.key_loaded===false&&Object.entries(MODELS).every(([k,model])=>JSON.stringify(s[k])===JSON.stringify({ready:false,model,setup:'MODEL_API_KEY'}))&&s.budget.spent_usd_today===0&&s.budget.cap_usd===5,s);
 const setup={error:'setup_required',setup_required:'MODEL_API_KEY',message:'Setup required: MODEL_API_KEY is not set on the gateway.'};
 for(const path of ['/api/plan','/api/panorama','/api/transcribe']) check(`G02-${path}`,JSON.stringify(await req(path,'POST','{',503))===JSON.stringify(setup));
 check('G09-empty',JSON.stringify(await req('/api/runs'))===JSON.stringify({runs:[]}));
 const runs=[];
 for(const source of ['cc0-sample','user-upload']) {
  const r=await req('/api/runs','POST',{room,source,destination:'real audit sample',sample_id:'misty_pines'},201);runs.push(r);created=r;
  const disk=JSON.parse(readFileSync(`${dir}/${r.id}.json`));
  check(`G03-${source}`,JSON.stringify(r)===JSON.stringify(disk)&&r.plan===null&&r.transcript===null&&r.pano===null&&r.timings===null&&r.cost_usd===0&&r.errors.length===0&&r.image.stamp===(source==='cc0-sample'?'Sample, not generated':'Your image, not generated')&&Object.entries(r.image).filter(([k])=>['model','request_id','latency_ms','width','height','format','file'].includes(k)).every(([,v])=>v===null),r);
  await new Promise(r=>setTimeout(r,10));
 }
 let list=await req('/api/runs');check('G09-list',list.runs.length===2&&list.runs[0].id===runs[1].id,list.runs.map(r=>r.id));
 const r=runs[0],path=`/api/runs/${r.id}`;
 check('G04-get',JSON.stringify(await req(path))===JSON.stringify(r));
 const patched=await req(path,'PATCH',{pano:{pano_mode:'equirect',note:'client analysis'},timings:{time_to_world_ms:1234,invalid:'ignored'},width:4096,height:2048});
 const again=await req(path,'PATCH',{width:1,height:2});
 check('G04-patch',patched.pano.pano_mode==='equirect'&&JSON.stringify(patched.timings)==='{"time_to_world_ms":1234}'&&again.image.width===4096&&again.image.height===2048,again);
 check('G11-empty-patch',JSON.stringify(await req(path,'PATCH',{}))===JSON.stringify(again));
 check('G04-no-image',JSON.stringify(await req(`${path}/image`,'GET',undefined,404))==='{"error":"no_image"}');
 // Route-only fixture: actual CC0 bytes in the real file store, honestly stamped.
 const imageRun=await req('/api/runs','POST',{room,source:'cc0-sample',sample_id:'misty_pines'},201);
 const bytes=readFileSync(`${root}/packages/xr/public/panoramas/misty_pines.jpg`),file=`${imageRun.id}.jpg`;
 imageRun.image={...imageRun.image,file,format:'jpeg',width:4096,height:2048};
 writeFileSync(`${dir}/${file}`,bytes);writeFileSync(`${dir}/${imageRun.id}.json`,JSON.stringify(imageRun));
 const imageResponse=await api.get(`http://127.0.0.1:8430/api/runs/${imageRun.id}/image`),received=await imageResponse.body();
 const imageEvidence={fixture:'real committed CC0 JPEG in actual run store; image GET/delete route only, no generated/model result',status:imageResponse.status(),headers:imageResponse.headers(),bytes:received.length,sha256:createHash('sha256').update(received).digest('hex')};
 events.push({path:`/api/runs/${imageRun.id}/image`,method:'GET',expected:200,...imageEvidence});
 check('G04-stored-image',imageResponse.status()===200&&received.equals(bytes)&&imageResponse.headers()['content-type']==='image/jpeg'&&imageResponse.headers()['cache-control']==='private, max-age=3600',imageEvidence);
 await req(`/api/runs/${imageRun.id}`,'DELETE');check('G04-image-deleted',!readdirSync(dir).includes(file));
 check('G04-delete',JSON.stringify(await req(path,'DELETE'))===JSON.stringify({deleted:r.id})&&!readdirSync(dir).includes(`${r.id}.json`));
 for(const method of ['GET','PATCH','DELETE'])check(`G04-unknown-${method}`,JSON.stringify(await req(path,method,method==='PATCH'?{}:undefined,404))==='{"error":"no_such_run"}');
 for(const body of ['{nope','null','[]','12','"string"']) check(`G05-json-${body}`,JSON.stringify(await req('/api/runs','POST',body,400))==='{"error":"bad_json","message":"Body must be a JSON object."}');
 check('G05-size',JSON.stringify(await req('/api/runs','POST',JSON.stringify({x:'a'.repeat(65536)}),413))==='{"error":"too_large","limit_bytes":65536}');
 check('G05-path',JSON.stringify(await req('/api/nope','GET',undefined,404))==='{"error":"not_found"}');
 for(const source of ['muse-image-1.0',undefined])check(`G10-source-${source}`,JSON.stringify(await req('/api/runs','POST',{room,source},400))===JSON.stringify({error:'bad_source',message:"source must be 'cc0-sample' or 'user-upload'"}));
 for(const room of [undefined,null,{},'x']) {const b=await req('/api/runs','POST',{room,source:'cc0-sample'},400);check(`G10-room-${JSON.stringify(room)}`,b.error==='bad_room'&&b.details.length>0,b);}
 const large=await req('/api/runs','POST',{room:{...room,more:'x'.repeat(8001)},source:'cc0-sample'},400);check('G11-room-size',large.error==='bad_room'&&large.details.includes('room: too large'),large);
 const blank=await req('/api/runs','POST',{room,source:'user-upload'},201);const long=await req('/api/runs','POST',{room,source:'user-upload',destination:'x'.repeat(400),sample_id:'x'.repeat(100)},201);
 check('G11-destination',blank.destination===''&&long.destination.length===300&&long.image.sample_id.length===64);
 await req('/api/status','OPTIONS',undefined,204,{Origin:'https://localhost:8443'});const allowed=events.at(-1);
 await req('/api/status','OPTIONS',undefined,204,{Origin:'https://unlisted.invalid'});const denied=events.at(-1);
 check('G16',allowed.headers['access-control-allow-origin']==='https://localhost:8443'&&allowed.headers.vary==='Origin'&&allowed.headers['access-control-allow-methods']==='GET,POST,PATCH,DELETE,OPTIONS'&&allowed.headers['access-control-allow-headers']==='Content-Type'&&!denied.headers['access-control-allow-origin'],{allowed,denied});
 for(const [p,m] of [['/api/status','POST'],['/api/runs','PUT'],['/api/runs/not-a-uuid','GET']])check(`G17-${p}-${m}`,JSON.stringify(await req(p,m,undefined,404))==='{"error":"not_found"}');
 check('G17-image-method',JSON.stringify(await req(`/api/runs/${blank.id}/image`,'POST',{},404))==='{"error":"no_image"}');
 check('G18-cache',events.filter(e=>e.status!==204&&!e.fixture).every(e=>e.headers['content-type']==='application/json; charset=utf-8'&&e.headers['cache-control']==='no-store'));
 for(const p of ['/api/clips','/api/tracks','/api/asr','/api/panorama/upload'])check(`D01-D03-G22-${p}`,JSON.stringify(await req(p,p==='/api/panorama/upload'?'POST':'GET',undefined,404))==='{"error":"not_found"}');
 check('G09-delete-reflected',!(await req('/api/runs')).runs.some(x=>x.id===r.id));
 check('G08-keyless',!JSON.stringify(events).includes('Bearer ')&&JSON.stringify(s).includes('"key_loaded":false')&&!readFileSync(`${root}/audit/gateway/boot.log`,'utf8').includes('MODEL_API_KEY: loaded'));
 writeFileSync(`${root}/audit/gateway/restart-record.json`,JSON.stringify({id:blank.id,record:blank,patched:again},null,2));
} catch(e) {check('gateway-completed',false,e.message);} finally {
 await browser.close();writeFileSync(`${root}/audit/gateway/checks.json`,JSON.stringify({passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));writeFileSync(`${root}/audit/gateway/events.json`,JSON.stringify(events,null,2));
}
process.exitCode=checks.some(c=>!c.ok)?1:0;
