import{writeFileSync}from'node:fs';
import{cli,evalPage,sleep,snapshot,XR_DIR}from'./iwsdk.ts';
import{enterSession,pinchDrag,pressCard,waitFor,wallPoint}from'./scenario.ts';
const out=process.env.THYRA_AUDIT_DIR!,checks:Array<{id:string;ok:boolean;detail?:unknown}>=[];const check=(id:string,ok:boolean,detail?:unknown)=>{checks.push({id,ok,detail});console.log(`${ok?'PASS':'FAIL'} ${id}`);};
async function reset(){evalPage(`window.__thyra.loadRoom('sunlit_living_room')`,90000);cli('xr','set-device-state',{});cli('xr','set-input-mode',{mode:'hand'});return waitFor(s=>s.walls.length>=4,15000);}
async function draw(){const s=await reset(),w=s.walls.reduce((a,b)=>b.n[2]>a.n[2]?b:a),fv=(s.floorY??0)-w.origin[1];await pinchDrag(wallPoint(s,w.id,-.5,fv+1.9),wallPoint(s,w.id,.5,fv+.03));return w;}
try{
 cli('browser','reload',{});await sleep(3000);await enterSession();
 for(const mode of ['room','session']){
  await draw();evalPage(`(async()=>{window.__auditInterrupt={ran:false,mode:${JSON.stringify(mode)}};const w=window.FRAMEWORK_MCP_RUNTIME.world;const{ThyraSystem}=await import('/src/thyra-system.ts');const s=w.getSystem(ThyraSystem);w.onXRFrame(()=>{if(window.__auditInterrupt.mode!==${JSON.stringify(mode)}||window.__auditInterrupt.ran||s.card.view.kind!=='working')return;window.__auditInterrupt={ran:true,mode:${JSON.stringify(mode)},at:performance.now(),view:{...s.card.view},phase:s.portals[0]?.view.phase};${mode==='room'?"window.__thyra.loadRoom('thyra_studio').then(()=>window.__auditInterrupt.completed=true);":"setTimeout(()=>{window.__auditInterrupt.endView={...s.card.view};window.__auditInterrupt.endPhase=s.portals[0]?.view.phase;w.session.end().then(()=>window.__auditInterrupt.completed=true);},400);"}});return true;})()`);
  await pressCard('dest-misty_pines');await sleep(1800);const observed=evalPage<any>('window.__auditInterrupt');check(`X21-interrupted-during-hold-${mode}`,observed.ran&&observed.completed&&observed.view.kind==='working'&&observed.phase==='painting'&&(mode!=='session'||observed.endView?.kind==='working'&&observed.endPhase==='painting'),observed);
  if(mode==='session'){cli('xr','enter',{});await sleep(800);cli('xr','set-input-mode',{mode:'hand'});}
  const next=await draw();check(`X21-fresh-draw-${mode}`,snapshot().portals.length===1&&snapshot().card?.view==='choose',snapshot());await pressCard('close');
 }
 const w=await draw();await pressCard('dest-the_sky_is_on_fire');await waitFor(s=>s.portals[0]?.phase==='open',20000);cli('xr','set-transform',{device:'headset',position:{x:0,y:1.6,z:w.origin[2]+.2}});await waitFor(s=>s.portals[0]?.step==='inside',10000);
 const back=evalPage<any>(`(async()=>{const w=window.FRAMEWORK_MCP_RUNTIME.world;const{ThyraSystem}=await import('/src/thyra-system.ts');const p=w.getSystem(ThyraSystem).portals[0],m=p.view.backDoor;return{entry:p.step.entry,normal:p.view.frame.n,position:m.getWorldPosition(m.position.clone()).toArray(),visible:m.visible,depthOnly:p.view.blocker.material.colorWrite===false,trim:p.view.backDoor.children.slice(1).map(m=>m.material.color.getHexString()),floorBand:p.view.flood.material.uniforms.bandRadius.value};})()`);
 const offset=(back.position[0]-back.entry[0])*back.normal[0]+(back.position[2]-back.entry[2])*back.normal[2];check('X22-way-back-placement',back.visible&&back.depthOnly&&Math.abs(offset-.7)<.001&&back.trim.every((c:string)=>c==='c8f03c')&&back.floorBand===1.6,{...back,roomwardOffset:offset});
 cli('xr','look-at',{device:'headset',target:{x:back.position[0],y:back.position[1],z:back.position[2]}});await sleep(300);cli('browser','screenshot',{},['--output-file','artifacts/e2e/audit-way-back.png']);
 cli('xr','set-transform',{device:'headset',position:{x:0,y:1.6,z:0}});await waitFor(s=>s.portals[0]?.step==='room',10000);await pressCard('close');
}catch(e){check('interrupt-completed',false,(e as Error).message);}
writeFileSync(`${out}/interrupt.json`,JSON.stringify({at:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));process.exitCode=checks.some(c=>!c.ok)?1:0;
