import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cli, evalPage, sleep, snapshot, XR_DIR, type Snapshot } from './iwsdk.ts';
import { enterSession, pinchDrag, pressCard, waitFor, wallPoint } from './scenario.ts';
const root=fileURLToPath(new URL('../',import.meta.url)),out=process.env.THYRA_AUDIT_DIR!;
const checks:Array<{id:string;ok:boolean;detail?:unknown}>=[];const check=(id:string,ok:boolean,detail?:unknown)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
const pid=Number(readFileSync('/tmp/thyra-t5-gateway.pid','utf8'));
let replacement:number|undefined;
const restart=async()=>{
 const fd=openSync(`${root}audit/gateway/boot.log`,'a');const p=spawn(process.execPath,[`${root}packages/gateway/src/main.ts`],{env:{...process.env,MODEL_API_KEY:'',THYRA_RUNS_DIR:'/tmp/thyra-t5-audit-runs',THYRA_ALLOWED_ORIGINS:'https://localhost:8443,http://127.0.0.1:8431'},stdio:['ignore',fd,fd]});closeSync(fd);replacement=p.pid;writeFileSync('/tmp/thyra-t5-gateway.pid',String(p.pid));p.unref();await sleep(1000);
};
async function reset(){evalPage(`window.__thyra.loadRoom('sunlit_living_room')`,90000);cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});return waitFor(s=>s.walls.length>=4,15000);}
async function draw(s:Snapshot){const w=s.walls.reduce((a,b)=>b.n[2]>a.n[2]?b:a),fv=(s.floorY??0)-w.origin[1];await pinchDrag(wallPoint(s,w.id,-.5,fv+1.9),wallPoint(s,w.id,.5,fv+.03));}
try {
 await enterSession();const s=await reset();await draw(s);await pressCard('dest-misty_pines');
 writeFileSync('/tmp/thyra-t5-stage','gateway-interruption-expected');process.kill(pid,'SIGTERM');
 await waitFor(x=>x.portals[0]?.phase==='open',20000);await sleep(600);let st=snapshot();
 check('X20-interrupted-write',st.portals[0].record.stamp==='Sample, not generated'&&Boolean(st.portals[0].record.record_error)&&!st.portals[0].record.run_id,st);
 await waitFor(x=>x.status===null,30000,'gateway offline status');
 cli('xr','exit',{});await sleep(300);const badges=evalPage<string[]>(`[...document.querySelectorAll('#thyra-badges li')].map(x=>x.textContent)`);check('A10-offline-badges',['Muse Spark','Muse Image','Muse Voice'].every(m=>badges.includes(`${m}: gateway offline`)),badges);
 await restart();writeFileSync('/tmp/thyra-t5-stage','gateway-restored');
 const saved=JSON.parse(readFileSync(`${root}audit/gateway/restart-record.json`,'utf8'));
 const persisted=await (await fetch(`http://127.0.0.1:8430/api/runs/${saved.id}`)).json();const status=await(await fetch('http://127.0.0.1:8430/api/status')).json();
 check('G18-restart',JSON.stringify(persisted)===JSON.stringify(saved.record)&&status.budget.spent_usd_today===0,{persisted,status,stoppedPid:pid,replacementPid:replacement});
 cli('xr','enter',{});await sleep(600);cli('xr','set-input-mode',{mode:'hand'});await waitFor(x=>Boolean(x.status),30000,'gateway restored status');
 const fresh=await reset();await draw(fresh);await pressCard('dest-the_sky_is_on_fire');await waitFor(x=>Boolean(x.portals[0]?.record.run_id),20000,'fresh persistence');st=snapshot();check('X20-restored-persistence',Boolean(st.portals[0].record.run_id)&&!st.portals[0].record.record_error,st);await pressCard('close');
} catch(e){check('offline-completed',false,(e as Error).message);} finally {if(!replacement)await restart();}
writeFileSync(`${out}/offline.json`,JSON.stringify({at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));process.exitCode=checks.some(c=>!c.ok)?1:0;
