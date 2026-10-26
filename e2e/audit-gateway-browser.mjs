import { createRequire } from 'node:module';
import { readFileSync,writeFileSync } from 'node:fs';
const require=createRequire(new URL('../packages/xr/package.json',import.meta.url)),{chromium}=require('playwright');
const browser=await chromium.launch({headless:true});const ctx=await browser.newContext({ignoreHTTPSErrors:true});const p=await ctx.newPage();const events=[],checks=[];let negative=false,id='navigation';
p.on('console',m=>events.push({type:'console',id,expected:negative,level:m.type(),message:m.text()}));p.on('pageerror',e=>events.push({type:'pageerror',id,message:e.message}));p.on('response',r=>events.push({type:'response',id,expected:negative,url:r.url(),status:r.status()}));p.on('requestfailed',r=>events.push({type:'requestfailed',id,url:r.url(),message:r.failure()?.errorText}));
const check=(id,ok,detail)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
const room=JSON.parse(readFileSync('packages/landing/data/schedule.json')).summary;
async function req(label,path,method='GET',body,expected=200){id=label;negative=expected>=400;const result=await p.evaluate(async({path,method,body})=>{const r=await fetch(path,{method,...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:typeof body==='string'?body:JSON.stringify(body)})});return {status:r.status,body:await r.json()};},{path,method,body});await p.waitForTimeout(50);check(label,result.status===expected,result);negative=false;return result.body;}
try {
 await p.goto('https://localhost:8443/',{waitUntil:'networkidle',timeout:90000});await p.waitForFunction(()=>document.querySelector('#thyra-badges')?.textContent.includes('MODEL_API_KEY'));
 const s=await req('G01','/api/status');check('G01-body',s.key_loaded===false&&s.service==='thyra-gateway'&&['spark','wonder','image','transcribe','sam3'].every(k=>s[k].ready===false&&s[k].setup==='MODEL_API_KEY'),s);
 for(const path of ['/api/plan','/api/panorama','/api/transcribe']){const r=await req(`G02-${path}`,path,'POST','{',503);check(`G02-body-${path}`,r.error==='setup_required'&&r.message==='Setup required: MODEL_API_KEY is not set on the gateway.',r);}
 const r=await req('G03','/api/runs','POST',{room,source:'cc0-sample',sample_id:'misty_pines',destination:'browser audit sample'},201);check('G03-body',r.image.stamp==='Sample, not generated'&&r.plan===null&&r.cost_usd===0,r);
 await req('G04-get',`/api/runs/${r.id}`);const patch=await req('G04-patch',`/api/runs/${r.id}`,'PATCH',{pano:{pano_mode:'equirect'},timings:{time_to_world_ms:1234,invalid:'x'},width:4096,height:2048});check('G04-body',patch.timings.time_to_world_ms===1234&&!('invalid'in patch.timings)&&patch.image.width===4096,patch);
 await req('G04-no-image',`/api/runs/${r.id}/image`,'GET',undefined,404);await req('G04-delete',`/api/runs/${r.id}`,'DELETE');await req('G04-deleted-get',`/api/runs/${r.id}`,'GET',undefined,404);
 for(const text of ['{bad','null','[]','2','"text"']){const b=await req('G05-json-'+text,'/api/runs','POST',text,400);check('G05-body-'+text,b.error==='bad_json'&&b.message==='Body must be a JSON object.',b);}
 await req('G05-large','/api/runs','POST',JSON.stringify({x:'a'.repeat(65536)}),413);await req('G05-unknown','/api/missing','GET',undefined,404);
 check('G08',!JSON.stringify(events).includes('Bearer '));
 const unexpected=events.filter(e=>e.type==='pageerror'||e.type==='requestfailed'||(!e.expected&&(e.level==='error'||e.status>=400)));check('browser-console-network',unexpected.length===0,unexpected);
}finally{await browser.close();writeFileSync('audit/gateway/browser-checks.json',JSON.stringify({passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));writeFileSync('audit/gateway/browser-events.json',JSON.stringify(events,null,2));}
process.exitCode=checks.some(c=>!c.ok)?1:0;
