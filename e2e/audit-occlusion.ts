import { writeFileSync } from 'node:fs';
import { cli, evalPage, sleep, snapshot, XR_DIR } from './iwsdk.ts';
import { enterSession, pinchDrag, pressCard, waitFor, wallPoint } from './scenario.ts';
import { patchMean, pngSize, rgbDist } from './pixels.ts';
const out=process.env.THYRA_AUDIT_DIR!;const results=[];
for(const disabled of [false,true]) {
 evalPage(`(location.search=${JSON.stringify(disabled?'?occlusion=0':'')},true)`);await sleep(3000);await enterSession();
 evalPage(`window.__thyra.loadRoom('sunlit_living_room')`,90000);cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});const s=await waitFor(s=>s.walls.length>=4,15000),w=s.walls.reduce((a,b)=>b.n[2]>a.n[2]?b:a),fv=(s.floorY??0)-w.origin[1];
 cli('xr','look-at',{device:'headset',target:{x:0,y:1.3,z:w.origin[2]}});
 await pinchDrag(wallPoint(s,w.id,-.6,fv+2.05),wallPoint(s,w.id,.6,fv+.03));await pressCard('dest-misty_pines');await waitFor(x=>x.portals[0]?.phase==='open',20000);await sleep(2300);
 const filename=`artifacts/e2e/audit-occlusion-${disabled?'off':'on'}.png`;cli('browser','screenshot',{},['--output-file',filename]);const path=`${XR_DIR}${filename}`;
 const pixels=evalPage<any>(`[window.__thyra.project([0,.5,${w.origin[2]}]),window.__thyra.project([0,1.5,${w.origin[2]}]),document.querySelector('canvas').clientWidth]`),scale=pngSize(path)[0]/pixels[2];
 const enabled=cli<any>('xr','status').enabledFeatures;
 results.push({disabled,features:enabled,foreground:patchMean(path,pixels[0][0]*scale,pixels[0][1]*scale),clear:patchMean(path,pixels[1][0]*scale,pixels[1][1]*scale),state:snapshot()});
 await pressCard('close');
}
const delta=rgbDist(results[0].foreground,results[1].foreground),clearDelta=rgbDist(results[0].clear,results[1].clear);
const result={at:new Date().toISOString(),ok:results[0].features.includes('depth-sensing')&&delta>5&&clearDelta<15,delta,clearDelta,results};writeFileSync(`${out}/occlusion.json`,JSON.stringify(result,null,2));console.log(result.ok?'PASS X25 occlusion comparison':'FAIL X25 occlusion comparison',delta,clearDelta);process.exitCode=result.ok?0:1;
