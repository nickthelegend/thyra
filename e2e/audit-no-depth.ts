import { readFileSync, writeFileSync } from 'node:fs';
import { cli, evalPage, sleep, snapshot, XR_DIR } from './iwsdk.ts';
import { captureReady } from './audit-capture.ts';
import { enterSession, pinchDrag, pressCard, waitFor, wallPoint } from './scenario.ts';
const path=`${XR_DIR}iwsdk.config.json`,original=readFileSync(path,'utf8'),out=process.env.THYRA_AUDIT_DIR!;const checks:Array<{id:string;ok:boolean;detail?:unknown}>=[];
const check=(id:string,ok:boolean,detail?:unknown)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
try {
 writeFileSync('/tmp/thyra-t5-stage','depth-session-reconfiguration');const cfg=JSON.parse(original);cfg.world.xr.features.depthSensing=false;writeFileSync(path,JSON.stringify(cfg,null,2)+'\n');await sleep(6500);await captureReady();
 cli('browser','reload',{});await sleep(3000);await enterSession();
 const st=cli<any>('xr','status');check('X25-no-depth-feature',!st.enabledFeatures.includes('depth-sensing'),st);
 evalPage(`window.__thyra.loadRoom('sunlit_living_room')`,90000);cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});const s=await waitFor(s=>s.walls.length>=4,15000),w=s.walls.reduce((a,b)=>b.n[2]>a.n[2]?b:a),fv=(s.floorY??0)-w.origin[1];
 await pinchDrag(wallPoint(s,w.id,-.5,fv+1.9),wallPoint(s,w.id,.5,fv+.03));await pressCard('dest-misty_pines');const open=await waitFor(x=>x.portals[0]?.phase==='open',20000);check('X25-open-without-depth',open.portals[0].record.stamp==='Sample, not generated',open);
} catch(e){check('no-depth-completed',false,(e as Error).message);}finally{writeFileSync(path,original);await sleep(6500);await captureReady();check('X25-config-restored',readFileSync(path,'utf8')===original);}
writeFileSync(`${out}/no-depth.json`,JSON.stringify({at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));process.exitCode=checks.some(c=>!c.ok)?1:0;
