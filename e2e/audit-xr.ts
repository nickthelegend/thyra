/** Independent hand-driven audit supplements; state reads never replace hand input. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { captureReady } from './audit-capture.ts';
import { cli, evalPage, sleep, snapshot, XR_DIR, type Snapshot, type Vec3 } from './iwsdk.ts';
import { aim, enterSession, HAND, pinchDrag, pressCard, waitFor, wallPoint } from './scenario.ts';
const checks: Array<{id:string;ok:boolean;detail?:unknown}>=[];
const check=(id:string,ok:boolean,detail?:unknown)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
const out=process.env.THYRA_AUDIT_DIR!;
const mode=process.argv[2]??'full';
const inspect=()=>evalPage<any>(`(async()=>{const w=window.FRAMEWORK_MCP_RUNTIME.world;const {ThyraSystem}=await import('/src/thyra-system.ts');const s=w.getSystem(ThyraSystem);return {card:s.card.view,regions:s.card.panel.regions,voiceLabel:s.card.voiceLabel,hudHidden:document.querySelector('#thyra-hud').hidden,busy:s.busy,reticle:s.reticle.visible,glows:[...s.wallGlow.values()].map(x=>({level:x.level,visible:x.group.visible})),views:s.portals.map(p=>({tag:p.view.tag,phase:p.view.phase,world:p.view.worldReady,openT:p.view.openT,revealT:p.view.revealT,back:p.view.backDoor.visible,flood:p.view.floodT,trim:p.view.trim.map(x=>x.visible)}))};})()`);
const near=(a:number,b:number,e=.001)=>Math.abs(a-b)<=e;
async function room(id='sunlit_living_room') {
 evalPage(`window.__thyra.loadRoom(${JSON.stringify(id)})`,90000);cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});
 return waitFor(s=>id==='none'?s.walls.length===0:s.walls.length>=3,20000,'room reset');
}
const back=(s:Snapshot)=>s.walls.reduce((a,b)=>b.n[2]>a.n[2]?b:a);
async function draw(s:Snapshot,u0:number,u1:number,h:number,reverse=false) {
 const w=back(s),fv=(s.floorY??0)-w.origin[1];const a=wallPoint(s,w.id,u0,fv+h),b=wallPoint(s,w.id,u1,fv+.03);
 await pinchDrag(reverse?b:a,reverse?a:b,6);return snapshot();
}
try {
 await captureReady();cli('browser','reload',{});await sleep(3000);await enterSession();
 evalPage(`(async()=>{window.__auditMotion=[];const w=window.FRAMEWORK_MCP_RUNTIME.world;const {ThyraSystem}=await import('/src/thyra-system.ts');const s=w.getSystem(ThyraSystem);w.onXRFrame(()=>{if(window.__auditMotion.length>1500)return;const d=s.drawing;if(d)window.__auditMotion.push({at:performance.now(),drawing:true,valid:d.valid,color:d.view.trim[0].material.color.getHexString()});for(const p of s.portals)if(p.view.openT<1||p.view.ink.visible)window.__auditMotion.push({at:performance.now(),tag:p.view.tag,open:p.view.openT,mask:p.view.mask.scale.x,width:p.view.width,ink:p.view.ink.visible,time:p.view.ink.material.uniforms.time.value});});return true;})()`);
 let s=await room();
 await draw(s,-.2,.2,.6);s=snapshot();
 check('X05-exact-minimum',s.portals.length===1&&near(s.portals[0].width,.4)&&near(s.portals[0].height,.6),s);
 if(s.portals.length)await pressCard('close');
 if(mode==='minimum') { /* Reverify the formerly failing boundary before the full replay. */ }
 else {
  s=await room();await draw(s,-.5,.5,1.9);await waitFor(x=>x.card?.view==='choose',5000);
  const card=snapshot();check('X10-hand-pointers',!JSON.stringify(card).includes('"kind":"controller"'),card);
  const bg=evalPage<Vec3>(`(async()=>{const w=window.FRAMEWORK_MCP_RUNTIME.world;const {ThyraSystem}=await import('/src/thyra-system.ts');const m=w.getSystem(ThyraSystem).card.panel.mesh;const g=m.geometry.parameters;return m.localToWorld(m.position.clone().set(-.49*g.width,.49*g.height,0)).toArray();})()`);aim(bg);cli('xr','select',{device:HAND,duration:.2});check('X16-background',snapshot().card?.view==='choose'&&snapshot().portals.length===1,snapshot());
  const initial=inspect();check('X03-exact-choose',initial.regions.find((r:any)=>r.id==='dest-generate')?.enabled===false&&initial.voiceLabel==='browser speech (not Meta)',initial);
  const before=snapshot();await pressCard('dest-generate');await sleep(300);check('X03-disabled-generate',snapshot().card?.view==='choose'&&snapshot().portals[0].phase==='framed',snapshot());
  evalPage(`(async()=>{window.__auditWorking=[];const w=window.FRAMEWORK_MCP_RUNTIME.world;const {ThyraSystem}=await import('/src/thyra-system.ts');const s=w.getSystem(ThyraSystem);w.onXRFrame(()=>{if(s.card.view.kind==='working')window.__auditWorking.push({...s.card.view,at:performance.now()});});return true;})()`);
  await pressCard('dest-misty_pines');await waitFor(x=>x.portals[0]?.phase==='open',20000);await sleep(1000);
  const working=evalPage<any[]>('window.__auditWorking');check('X03-working',working.some(x=>x.kind==='working'&&x.step==='Setup required: Muse Spark'),{frames:working.length,first:working[0],last:working.at(-1)});
  const motion=evalPage<any[]>('window.__auditMotion');const motionTag=snapshot().portals[0].tag;const invalid=motion.find(x=>x.drawing&&!x.valid),valid=motion.find(x=>x.drawing&&x.valid),tear=motion.filter(x=>x.tag===motionTag&&x.open<1);const duration=tear.length>1?(tear.at(-1).at-tear[0].at)/1000:0;
  check('X15-frame-animation',invalid?.color==='ffb547'&&valid?.color==='c8f03c'&&tear.some(x=>x.mask<x.width*.9)&&duration>.75&&duration<1.1,{invalid,valid,duration,first:tear[0],last:tear.at(-1)});
  const opened=inspect();check('X03-open-copy',opened.card.kind==='open'&&opened.card.stamp==='Sample, not generated'&&opened.card.planNote.includes('MODEL_API_KEY')&&opened.card.credit.includes('CC0'),opened);
  s=snapshot();check('X03-X19-stamp',s.portals[0].record.source==='cc0-sample'&&s.portals[0].record.stamp==='Sample, not generated'&&Boolean(s.portals[0].record.run_id),s);
  await pressCard('again');check('X16-rechoose',snapshot().card?.view==='choose');await pressCard('dest-satara_night');await waitFor(x=>x.portals[0]?.phase==='open',20000);s=snapshot();check('X17-satara',s.portals[0].record.sample_id==='satara_night'&&s.portals[0].record.stamp==='Sample, not generated',s.portals[0].record);await pressCard('close');
  s=await room();await draw(s,-.5,.5,1.9,true);const reverse=snapshot().portals[0];await pressCard('close');await draw(s,-.5,.5,1.9);const forward=snapshot().portals[0];check('X13-reverse',Object.keys(forward.rect).every(k=>near(forward.rect[k as keyof typeof forward.rect],reverse.rect[k as keyof typeof reverse.rect])),{forward,reverse});
  const original=snapshot().portals[0];await draw(s,-.3,.7,1.9);const overlap=snapshot();check('X14-overlap',overlap.portals.length===1&&overlap.portals[0].tag===original.tag&&overlap.hint===`That overlaps ${original.tag}. Draw the new door beside it.`,overlap);await pressCard('close');
  // Typed input uses the same pre-session form event as an actual user.
  cli('xr','exit',{});await sleep(500);
  evalPage(`(() => {const e=document.querySelector('#thyra-typed');e.value='  a flooded cathedral at dawn  ';e.dispatchEvent(new Event('input',{bubbles:true}));return true;})()`);
  cli('xr','enter',{});await sleep(1000);cli('xr','set-input-mode',{mode:'hand'});s=await room();await draw(s,-.5,.5,1.9);await pressCard('dest-typed');await waitFor(x=>x.portals[0]?.phase==='open',20000);s=snapshot();
  check('A07-typed',JSON.stringify(s.portals[0].summary).includes('"destination_text":"a flooded cathedral at dawn"')&&s.portals[0].record.stamp==='Sample, not generated',s.portals[0]);await pressCard('close');
  // User upload: a real File on the real form, using browser-run's Playwright capability.
  const uploadScript=`export default async function({page,frame}){ const f=frame??page; await f.locator('#thyra-upload').setInputFiles(${JSON.stringify(`${XR_DIR}public/panoramas/misty_pines.jpg`)}); return true; }`;
  writeFileSync(`${XR_DIR}e2e/audit-upload.mjs`,uploadScript);
  const {page}=await import('./iwsdk.ts');cli('xr','exit',{});await sleep(400);page('audit-upload.mjs');cli('xr','enter',{});await sleep(1000);cli('xr','set-input-mode',{mode:'hand'});s=await room();await draw(s,-.5,.5,1.9);await pressCard('dest-upload');await waitFor(x=>x.portals[0]?.phase==='open',20000);s=snapshot();check('A08-upload',s.portals[0].record.source==='user-upload'&&s.portals[0].record.stamp==='Your image, not generated',s);await pressCard('close');
  // Real per-room reach-through: put the emulated index tip behind each wall.
  for(const id of ['sunlit_living_room','thyra_studio','thyra_hall','bedroom']) {
   s=await room(id);await draw(s,-.5,.5,1.9);await pressCard('dest-misty_pines');await waitFor(x=>x.portals[0]?.phase==='open',20000);const p=snapshot().portals[0],wall=back(snapshot());
   evalPage(`(() => {window.__auditTransitions=[];const w=window.FRAMEWORK_MCP_RUNTIME.world;let prev='';w.onXRFrame(()=>{const p=window.__thyra.snapshot().portals[0];if(p&&p.step!==prev){prev=p.step;window.__auditTransitions.push({mode:p.step,at:performance.now(),flood:p.flood});}});return true;})()`);
   const tip=wallPoint(s,wall.id,0,(s.floorY??0)-wall.origin[1]+1.2);tip[0]-=wall.n[0]*.08;tip[2]-=wall.n[2]*.08;
   cli('xr','set-transform',{device:HAND,anchor:'index-tip',position:{x:tip[0],y:tip[1],z:tip[2]}});
   await waitFor(x=>x.portals[0]?.step==='inside',10000,'reach-through');const trace=evalPage<any[]>('window.__auditTransitions');const start=trace.find(x=>x.mode==='entering'),end=trace.find(x=>x.mode==='inside');
   check(`X04-reach-${id}`,Boolean(start&&end)&&near((end.at-start.at)/1000,1.2,.12),{trace,hand:cli('xr','get-hand-state',{device:HAND}),view:inspect()});
   cli('xr','set-transform',{device:HAND,anchor:'index-tip',position:{x:0,y:1,z:0}});cli('xr','set-transform',{device:'headset',position:{x:0,y:1.6,z:1}});await waitFor(x=>x.portals[0]?.step==='room',10000,'reach return');cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});await pressCard('close');
  }
  // Interrupt the asynchronous 900 ms room-read hold with a real room switch.
  s=await room();await draw(s,-.5,.5,1.9);await pressCard('dest-misty_pines');evalPage(`window.__thyra.loadRoom('thyra_studio')`,90000);await sleep(2500);s=snapshot();check('X21-room-switch',s.portals.length===0&&s.card===null,s);
  // Paper-wall invalid spacing and exact text; the valid path also runs in run.ts.
  s=await room('none');await waitFor(x=>x.hint==='No walls found. Run Space Setup, or pinch two points to place a paper wall.',15000);check('X06-exact-no-wall',true,snapshot().hint);
  aim([-1,0,-2]);cli('xr','select',{device:HAND,duration:.2});await sleep(200);check('X26-first',snapshot().hint==='First corner set. Pinch where the paper wall should end.');
  aim([-.8,0,-2]);cli('xr','select',{device:HAND,duration:.2});await sleep(200);s=snapshot();check('X26-too-narrow',s.walls.length===0&&s.hint==='Too narrow for a paper wall. Pinch two points at least 0.5 m apart.',s);
  aim([-1,0,-2]);cli('xr','select',{device:HAND,duration:.2});aim([1,0,-2]);cli('xr','select',{device:HAND,duration:.2});await sleep(400);s=snapshot();check('X07-exact-paper',s.walls.length===1&&s.walls[0].label==='paper wall (virtual)'&&s.hint==='Paper wall placed (virtual, not your wall). Pinch on it and drag a door.',s);
 }
} catch(e){check('supplement-completed',false,(e as Error).message);}
writeFileSync(`${out}/${mode==='minimum'?'minimum':'supplement'}.json`,JSON.stringify({at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));
process.exitCode=checks.some(c=>!c.ok)?1:0;
