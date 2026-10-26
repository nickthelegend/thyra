import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { captureReady } from './audit-capture.ts';
import { cli, evalPage, page, P, sleep, snapshot, XR_DIR, type Vec3, type Snapshot } from './iwsdk.ts';
import { enterSession, HAND, pinchDrag, pressCard, waitFor, wallPoint, aim } from './scenario.ts';
const out=process.env.THYRA_AUDIT_DIR!;
const checks:Array<{id:string;ok:boolean;detail?:unknown}>=[];
const check=(id:string,ok:boolean,detail?:unknown)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
const inspect=()=>evalPage<any>(`(async()=>{const w=window.FRAMEWORK_MCP_RUNTIME.world;const {ThyraSystem}=await import('/src/thyra-system.ts');const s=w.getSystem(ThyraSystem);return {card:s.card.view,regions:s.card.panel.regions,hudHidden:document.querySelector('#thyra-hud').hidden,busy:s.busy,reticle:s.reticle.visible,glows:[...s.wallGlow.values()].map(x=>({level:x.level,visible:x.group.visible})),views:s.portals.map(p=>({tag:p.view.tag,phase:p.view.phase,world:p.view.worldReady,openT:p.view.openT,revealT:p.view.revealT,back:p.view.backDoor.visible,flood:p.view.floodT,window:p.view.windowed?.visible,trim:p.view.trim.map(x=>x.visible)}))};})()`);
async function reset(id='sunlit_living_room') { evalPage(`window.__thyra.loadRoom(${JSON.stringify(id)})`,90000);cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});return waitFor(s=>s.walls.length>=3,20000); }
const back=(s:Snapshot)=>s.walls.reduce((a,b)=>b.n[2]>a.n[2]?b:a);
async function draw(s:Snapshot,u0=-.5,u1=.5,h=1.9) {const w=back(s),fv=(s.floorY??0)-w.origin[1];await pinchDrag(wallPoint(s,w.id,u0,fv+h),wallPoint(s,w.id,u1,fv+.03));return snapshot();}
async function upload(path:string){cli('xr','exit',{});await sleep(300);writeFileSync(`${XR_DIR}e2e/audit-file.mjs`,`export default async function({page,frame}){await (frame??page).locator('#thyra-upload').setInputFiles(${JSON.stringify(path)});}`);page('audit-file.mjs');cli('xr','enter',{});await sleep(800);cli('xr','set-input-mode',{mode:'hand'});}
try {
 await captureReady();cli('browser','reload',{});await sleep(3000);await enterSession();
 // Browser modules: WAV encoder, hit regions, real PNG/WebP encodings.
 const unit=evalPage<any>(`(async()=>{const {encodeWav}=await import('/src/voice.ts');const {CanvasPanel}=await import('/src/canvas-panel.ts');const wav=await encodeWav(new Float32Array([-2,-1,0,1,2]),16000).arrayBuffer();const d=new DataView(wav);const c=new CanvasPanel('audit region',100,100,1);c.regions=[{id:'enabled',x:10,y:10,w:20,h:20,enabled:true},{id:'disabled',x:50,y:10,w:20,h:20,enabled:false}];const result={header:String.fromCharCode(...new Uint8Array(wav).slice(0,4)),format:String.fromCharCode(...new Uint8Array(wav).slice(8,12)),channels:d.getUint16(22,true),rate:d.getUint32(24,true),bits:d.getUint16(34,true),bytes:d.getUint32(40,true),samples:[0,1,2,3,4].map(i=>d.getInt16(44+i*2,true)),hits:[c.regionAt({x:.2,y:.8}),c.regionAt({x:.6,y:.8}),c.regionAt({x:.9,y:.1})]};c.mesh.geometry.dispose();c.mesh.material.dispose();c.texture.dispose();return result;})()`);
 check('U17',unit.header==='RIFF'&&unit.format==='WAVE'&&unit.channels===1&&unit.rate===16000&&unit.bits===16&&unit.bytes===10&&JSON.stringify(unit.samples)==='[-32767,-32767,0,32767,32767]'&&JSON.stringify(unit.hits)==='["enabled",null,null]',unit);
 let s=await reset();const w=back(s),fv=(s.floorY??0)-w.origin[1];aim(wallPoint(s,w.id,0,fv+1.3));await sleep(400);let view=inspect();check('X15-hover',view.reticle&&view.glows.some((g:any)=>g.visible&&g.level>.1),view);
 // Clamp a hand drag past both right and top edges.
 await pinchDrag(wallPoint(s,w.id,1.5,fv+1.8),wallPoint(s,w.id,4,3));s=snapshot();check('X13-clamp',s.portals.length===1&&Math.abs(s.portals[0].rect.u1-w.bounds.u1)<1e-5&&Math.abs(s.portals[0].rect.v1-w.bounds.v1)<1e-5,s);if(s.portals.length)await pressCard('close');
 // Adjacent doors share an exact projected edge; no overlap area.
 s=await reset();await draw(s,-1,0);const first=snapshot().portals[0];await draw(s,-2,-1);s=snapshot();check('X14-adjacent',s.portals.length===2,{first,after:s});if(s.portals.length)await pressCard('close');
 // Real square JPEG and corrupt image Files exercise decoder and recovery.
 execFileSync('sips',['-z','512','512',`${XR_DIR}public/panoramas/misty_pines.jpg`,'--out','/tmp/thyra-t5-square.jpg'],{stdio:'ignore'});
 await upload('/tmp/thyra-t5-square.jpg');s=await reset();await draw(s);await pressCard('dest-upload');await waitFor(x=>x.portals[0]?.phase==='open',20000);view=inspect();s=snapshot();check('X18-square',s.portals[0].record.pano_mode==='cylinder'&&s.portals[0].record.stamp==='Your image, not generated'&&view.card.analysis.width===512&&view.card.analysis.height===512,{state:s,view});await pressCard('close');
 writeFileSync('/tmp/thyra-t5-corrupt.jpg','this is deliberately not encoded image data');await upload('/tmp/thyra-t5-corrupt.jpg');s=await reset();await draw(s);await pressCard('dest-upload');await waitFor(x=>x.card?.view==='error',10000);view=inspect();check('X18-corrupt',view.card.kind==='error'&&view.card.message.length>0&&view.regions.some((r:any)=>r.id==='again')&&view.regions.some((r:any)=>r.id==='close'),view);await pressCard('again');await pressCard('dest-the_sky_is_on_fire');await waitFor(x=>x.portals[0]?.phase==='open',20000);check('X18-retry',snapshot().portals[0].record.source==='cc0-sample');await pressCard('close');
 // Actual microphone denial, without injecting a speech recognizer or fake audio.
 const mic=evalPage<any>(`(async()=>{const {MicRecorder}=await import('/src/voice.ts');const r=new MicRecorder();try{await r.start();const b=await r.stop();return {captured:true,size:b.size};}catch(e){return {captured:false,name:e.name,message:e.message};}})()`);
 check('X28-device-unavailable',!mic.captured&&['NotAllowedError','NotFoundError'].includes(mic.name),mic);
 s=await reset();await draw(s);await pressCard('mic');await sleep(1500);view=inspect();check('X27-actual-speech-error',view.card.kind==='error'&&view.card.message.startsWith('Browser speech error:'),view);await pressCard('close');
 // Mid-hold session exit must not hide a stale selecting state after re-entry.
 s=await reset();await draw(s);await pressCard('dest-misty_pines');cli('xr','exit',{});await sleep(1600);view=inspect();check('A12-HUD-exit',!view.hudHidden,view);cli('xr','enter',{});await sleep(800);cli('xr','set-input-mode',{mode:'hand'});s=await reset();await draw(s);check('X21-session-reentry',snapshot().portals.length===1&&snapshot().card?.view==='choose',inspect());await pressCard('close');
} catch(e){check('edges-completed',false,(e as Error).message);}
writeFileSync(`${out}/edges.json`,JSON.stringify({at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));process.exitCode=checks.some(c=>!c.ok)?1:0;
