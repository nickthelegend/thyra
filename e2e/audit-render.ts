import { writeFileSync } from 'node:fs';
import { cli, evalPage, sleep, snapshot, XR_DIR, type Snapshot, type Vec3 } from './iwsdk.ts';
import { enterSession, pinchDrag, pressCard, waitFor, wallPoint } from './scenario.ts';
import { patchMean, pngSize, rgbDist } from './pixels.ts';
const out=process.env.THYRA_AUDIT_DIR!;const checks:Array<{id:string;ok:boolean;detail?:unknown}>=[];const check=(id:string,ok:boolean,detail?:unknown)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
const shot=(name:string)=>{cli('browser','screenshot',{},['--output-file',`artifacts/e2e/audit-${name}.png`]);return `${XR_DIR}artifacts/e2e/audit-${name}.png`;};
const read=()=>evalPage<any>(`(async()=>{const w=window.FRAMEWORK_MCP_RUNTIME.world;const {ThyraSystem}=await import('/src/thyra-system.ts');const s=w.getSystem(ThyraSystem);return {card:s.card.view,cardVisible:s.card.panel.mesh.visible,hintVisible:s.hint.mesh.visible,glows:[...s.wallGlow.values()].map(g=>g.group.visible),portals:s.portals.map(p=>({geometry:p.view.windowed?.geometry.type,ground:p.view.windowed?Math.min(...Array.from(p.view.windowed.geometry.getAttribute('position').array).filter((_,i)=>i%3===1))+p.view.windowed.getWorldPosition(p.view.windowed.position.clone()).y:null,discs:p.view.extras.map(m=>({geometry:m.geometry.type,color:m.material.color.getHexString(),y:m.position.y})),tag:p.view.tag,stencil:p.view.stencilRef,flood:p.view.floodT,back:{visible:p.view.backDoor.visible,position:p.view.backDoor.position.toArray()},window:p.view.windowed?.visible,texture:p.view.texture?.image?{width:p.view.texture.image.width,height:p.view.texture.image.height}:null}))};})()`);
async function reset(){evalPage(`window.__thyra.loadRoom('sunlit_living_room')`,90000);cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});return waitFor(s=>s.walls.length>=4,15000);}
const back=(s:Snapshot)=>s.walls.reduce((a,b)=>b.n[2]>a.n[2]?b:a);
async function draw(s:Snapshot){const w=back(s),fv=(s.floorY??0)-w.origin[1];await pinchDrag(wallPoint(s,w.id,-.6,fv+2.05),wallPoint(s,w.id,.6,fv+.03));}
try {
 cli('browser','reload',{});await sleep(3000);await enterSession();let s=await reset(),w=back(s);
 cli('xr','look-at',{device:'headset',target:{x:0,y:1.3,z:w.origin[2]}});await sleep(300);
 const base=shot('stencil-base');const point:Vec3=[0,1.5,w.origin[2]];const pix=evalPage<[number,number]>(`window.__thyra.project(${JSON.stringify(point)})`),cw=evalPage<number>(`document.querySelector('canvas').clientWidth`),scale=pngSize(base)[0]/cw;
 const mean=(path:string)=>patchMean(path,pix[0]*scale,pix[1]*scale);
 const cycles=[];
 for(let i=0;i<8;i++) {
  await draw(s);await waitFor(x=>x.card?.view==='choose',5000);const sample=['misty_pines','the_sky_is_on_fire','satara_night'][i%3];await pressCard(`dest-${sample}`);await waitFor(x=>x.portals[0]?.phase==='open',20000);await sleep(2000);const p=snapshot().portals[0],r=read(),open=shot(`stencil-${i}-open`),openDelta=rgbDist(mean(base),mean(open));
  check(`X23-ground-mode-${i}`,r.card.mode==='cylinder'?r.portals[0].discs.length===2&&r.portals[0].discs.every((d:any)=>d.geometry==='CircleGeometry'):Math.abs(r.portals[0].ground-(s.floorY??0))<.001,r.portals[0]);
  check(`X17-X24-open-${i}`,openDelta>5&&p.record.sample_id===sample&&r.card.credit.includes('CC0')&&r.card.stamp==='Sample, not generated',{sample,tag:p.tag,stencil:r.portals[0].stencil,openDelta,card:r.card});
  await pressCard('close');await sleep(500);const close=shot(`stencil-${i}-closed`),closeDelta=rgbDist(mean(base),mean(close));check(`X24-closed-${i}`,snapshot().portals.length===0&&closeDelta<15,{closeDelta});cycles.push({tag:p.tag,stencil:r.portals[0].stencil,sample,openDelta,closeDelta});
 }
 check('X24-recycled-stencils',new Set(cycles.map(c=>c.tag)).size===8&&new Set(cycles.map(c=>c.stencil)).size===7,cycles);
 // X02 retains its >25 forest contrast gate. X24 detects any clear sample change
 // (the real Satara cylinder sky is close to the wall at this probe).
 // Three different live textures and stencil identities, with a pixel probe on each wall.
 const walls=[w,s.walls.reduce((a,b)=>b.n[0]<a.n[0]?b:a),s.walls.reduce((a,b)=>b.n[0]>a.n[0]?b:a)];
 const samples=['misty_pines','satara_night','the_sky_is_on_fire'];
 for(let i=0;i<3;i++) {
  const wall=walls[i],fv=(s.floorY??0)-wall.origin[1];const u0=i===0?-.6:i===1?-1.5:1,u1=i===0?.6:i===1?-.7:1.9;
  const center=wallPoint(s,wall.id,(u0+u1)/2,fv+1.5);cli('xr','look-at',{device:'headset',target:{x:center[0],y:center[1],z:center[2]}});await sleep(300);const empty=shot(`multi-${i}-base`);
  await pinchDrag(wallPoint(s,wall.id,u0,fv+2),wallPoint(s,wall.id,u1,fv+.03));await pressCard(`dest-${samples[i]}`);await waitFor(x=>x.portals[i]?.phase==='open',20000);await sleep(2000);const full=shot(`multi-${i}-open`);
  const pxy=evalPage<[number,number]>(`window.__thyra.project(${JSON.stringify(center)})`),k=pngSize(full)[0]/cw;const d=rgbDist(patchMean(empty,pxy[0]*k,pxy[1]*k),patchMean(full,pxy[0]*k,pxy[1]*k));
  check(`X24-three-worlds-${i}`,d>25&&snapshot().portals[i].record.sample_id===samples[i],{sample:samples[i],delta:d,portals:snapshot().portals.map(p=>({tag:p.tag,source:p.record.sample_id}))});
 }
 const identities=evalPage<any>(`(async()=>{const w=window.FRAMEWORK_MCP_RUNTIME.world;const {ThyraSystem}=await import('/src/thyra-system.ts');return w.getSystem(ThyraSystem).portals.map(p=>({tag:p.view.tag,source:p.record.sample_id,texture:p.view.texture.uuid,mask:p.view.mask.material.stencilRef,world:p.view.windowed.material.stencilRef}));})()`);
 check('X24-three-identities',new Set(identities.map((p:any)=>p.texture)).size===3&&new Set(identities.map((p:any)=>p.mask)).size===3&&identities.every((p:any)=>p.mask===p.world),identities);
 s=await reset();w=back(s);cli('xr','look-at',{device:'headset',target:{x:0,y:1.3,z:w.origin[2]}});
 await draw(s);await pressCard('dest-the_sky_is_on_fire');await waitFor(x=>x.portals[0]?.phase==='open',20000);await sleep(2000);const fixed=snapshot().portals[0].corners;
 const before=shot('parallax-before');cli('xr','set-transform',{device:'headset',position:{x:.6,y:1.6,z:0}});await sleep(300);const after=shot('parallax-after');const now=snapshot().portals[0],afterPixel=evalPage<[number,number]>(`window.__thyra.project(${JSON.stringify(point)})`),delta=rgbDist(mean(before),patchMean(after,afterPixel[0]*scale,afterPixel[1]*scale));check('X23-parallax',JSON.stringify(fixed)===JSON.stringify(now.corners)&&delta>2,{delta,corners:now.corners,card:read().card});
 // Full flood must hide panels and leave the way-back door in the actual scene.
 cli('xr','set-transform',{device:'headset',position:{x:0,y:1.6,z:w.origin[2]+.2}});await waitFor(x=>x.portals[0]?.step==='inside',10000);const inside=read();shot('inside');
 check('X22-scene',inside.portals[0].flood===1&&inside.portals[0].back.visible&&!inside.cardVisible&&!inside.hintVisible&&inside.glows.every((x:boolean)=>!x),inside);
 cli('xr','set-transform',{device:'headset',position:{x:0,y:1.6,z:w.origin[2]+1}});await waitFor(x=>x.portals[0]?.step==='room',10000);check('X22-return',read().cardVisible,read());await pressCard('close');
} catch(e){check('render-completed',false,(e as Error).message);}
writeFileSync(`${out}/render.json`,JSON.stringify({at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));process.exitCode=checks.some(c=>!c.ok)?1:0;
