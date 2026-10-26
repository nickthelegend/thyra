import { fileURLToPath } from 'node:url';
/** Real served pages and files; no request interception or response substitution. */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../packages/xr/package.json', import.meta.url));
const { chromium } = require('playwright');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const checks = [], events = [];
const check = (id, ok, detail) => { checks.push({ id, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${id}`); };
const types = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css', '.json':'application/json', '.mp4':'video/mp4', '.jpg':'image/jpeg', '.woff2':'font/woff2' };
const temp = '/tmp/thyra-t5-landing';
rmSync(temp, { recursive:true, force:true });
cpSync(join(root,'packages/landing'), temp, { recursive:true });
for (const variant of ['empty','missing']) {
 cpSync(join(root,'packages/landing'), join(temp, variant), { recursive:true });
 const path = join(temp,variant,'data/schedule.json');
 if (variant === 'empty') { const data = JSON.parse(readFileSync(path)); data.rows=[]; writeFileSync(path,JSON.stringify(data)); }
 else rmSync(path);
}
function serve(dir, port) {
 const server = createServer((req,res) => {
   let p = decodeURIComponent(new URL(req.url,'http://x').pathname);
   if (p.endsWith('/')) p += 'index.html';
   const path = resolve(dir, '.'+p);
   if (!path.startsWith(dir+'/') || !existsSync(path)) return void res.writeHead(404).end('not found');
   res.writeHead(200, {'Content-Type':types[extname(path)] ?? 'application/octet-stream'}).end(readFileSync(path));
 });
 return new Promise(r => server.listen(port,'127.0.0.1',()=>r(server)));
}
const servers = [await serve(temp,8431), await serve(join(root,'packages/xr/dist'),8432)];
const browser = await chromium.launch({headless:true});
const source = JSON.parse(readFileSync(join(root,'packages/landing/data/schedule.json')));
function watch(page, label, negative = false) {
 page.on('console',m=>events.push({label:page.__auditLabel??label,type:'console',level:m.type(),message:m.text(),negative}));
 page.on('pageerror',e=>events.push({label:page.__auditLabel??label,type:'pageerror',message:e.message,negative}));
 page.on('response',r=>events.push({label:page.__auditLabel??label,type:'response',url:r.url(),status:r.status(),negative}));
 page.on('requestfailed',r=>events.push({label:page.__auditLabel??label,type:'requestfailed',url:r.url(),message:r.failure()?.errorText,negative}));
}
const clean = label => !events.some(e=>e.label===label && !e.negative && (e.type==='pageerror'||e.type==='requestfailed'||e.level==='error'||e.status>=400));
try {
 for (const width of [375,1280]) {
  const ctx = await browser.newContext({viewport:{width,height:812},ignoreHTTPSErrors:true});
  const p = await ctx.newPage(), label = `landing-${width}`;watch(p,label);
  await p.goto('http://127.0.0.1:8431/',{waitUntil:'networkidle'});
  check(`L01-${width}`,await p.locator('h1').textContent()==='Open a door in your own wall.');
  check(`L03-${width}`,await p.locator('#honest').evaluate(e=>['Setup required','Muse Spark','Muse Image','Muse Voice','MODEL_API_KEY'].every(t=>e.textContent.includes(t))));
  check(`L04-closed-${width}`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for (const hash of ['how','proof','honest','evidence','try']) {
   const links=p.locator(`a[href="#${hash}"]`); await links.first().click();
   check(`L09-${hash}-${width}`,await p.locator(`#${hash}`).count()===1 && (hash!=='evidence'||await p.locator('details#evidence').evaluate(e=>e.open)));
  }
  await p.locator('details#evidence').evaluate(e=>e.open=true);
  check(`L02-${width}`,await p.locator('#doors').evaluate(e=>['P-01','sunlit_living_room · emulator','1.20 × 2.05 m','Setup required','Sample, not generated'].every(t=>e.textContent.includes(t))));
  check(`L04-open-${width}`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(`L10-${width}`,JSON.stringify(JSON.parse(await p.locator('#summary').textContent()))===JSON.stringify(source.summary) && await p.locator('#summary-src').textContent()===source.summary_from && await p.locator('#schedule-src').textContent()===`Source: ${source.source} · 56/56 e2e checks passed`);
  const media=await p.locator('#hero-video').evaluate(v=>({ready:v.readyState,poster:v.poster,caption:v.closest('figure').textContent}));
  check(`L07-${width}`,media.ready>=2 && media.caption.includes('Recorded run · IWER emulator, synthetic living room · CC0 sample panorama'),media);
  check(`L14-${width}`,await p.locator('body').evaluate(e=>['No device run yet, and no Meta model run yet','Poly Haven','CC0','DELETE /api/runs/{id}'].every(t=>e.textContent.includes(t))));
  const summary=p.locator('details#evidence > summary'); await summary.focus();await p.keyboard.press('Enter');const closed=await p.locator('details#evidence').evaluate(e=>!e.open);await summary.click();
  check(`L09-toggle-${width}`,closed&&await p.locator('details#evidence').evaluate(e=>e.open));
  await p.goto('http://127.0.0.1:8431/#evidence',{waitUntil:'networkidle'});
  check(`L09-hash-${width}`,await p.locator('details#evidence').evaluate(e=>e.open));
  const fonts=await p.evaluate(()=>({host:document.fonts.check('16px "Host Grotesk"'),mono:document.fonts.check('16px "Ubuntu Sans Mono"')}));
  check(`L08-${width}`,fonts.host&&fonts.mono,events.filter(e=>e.label===label&&/fonts\.(googleapis|gstatic)/.test(e.url??'')));
  await p.screenshot({path:join(root,`audit/landing/landing-${width}.jpg`),type:'jpeg',quality:18,fullPage:true});
  check(`L05-L06-${width}`,clean(label),events.filter(e=>e.label===label&&(e.level==='error'||e.status>=400||e.type==='pageerror'||e.type==='requestfailed')));
  await ctx.close();
 }
 for (const [variant,id] of [['empty','L11'],['missing','L12']]) {
  const p=await browser.newPage();watch(p,id,variant==='missing');await p.goto(`http://127.0.0.1:8431/${variant}/`,{waitUntil:'networkidle'});
  check(id,await p.locator('#doors').textContent()===(variant==='empty'?'No runs recorded yet.':'Could not load the run data (HTTP 404).')&&(variant==='empty'?JSON.parse(await p.locator('#summary').textContent()).light.available===false:await p.locator('#summary').textContent()==='Could not load the run data.'));
  await p.close();
 }
 const reduced=await browser.newPage({reducedMotion:'reduce'});watch(reduced,'L13');await reduced.goto('http://127.0.0.1:8431/',{waitUntil:'networkidle'});
 const reducedState=await reduced.evaluate(()=>{const v=document.querySelector('#hero-video'), path=document.querySelector('.door-line');return {autoplay:v.hasAttribute('autoplay'),paused:v.paused, paths:[...document.querySelectorAll('svg *')].filter(e=>getComputedStyle(e).strokeDashoffset==='0px').length,scroll:getComputedStyle(document.documentElement).scrollBehavior};});
 check('L13',!reducedState.autoplay&&reducedState.paused&&reducedState.paths>0&&reducedState.scroll!=='smooth',reducedState);await reduced.close();
 for (const width of [375,1280]) {
  const ctx=await browser.newContext({viewport:{width,height:812},ignoreHTTPSErrors:true});const p=await ctx.newPage(),label=`app-${width}`;watch(p,label);
  await p.goto('https://localhost:8443/',{waitUntil:'networkidle',timeout:90000});await p.waitForFunction(()=>document.querySelector('#thyra-badges')?.textContent.includes('MODEL_API_KEY'));
  check(`A01-${width}`,await p.locator('#thyra-enter').textContent()==='Enter the emulated room');
  check(`A02-${width}`,(await p.locator('#thyra-xr-note').textContent()).includes('Emulated room (IWER), not your room'));
  const badges=await p.locator('#thyra-badges li').allTextContents();check(`A03-${width}`,['Muse Spark','Muse Image','Muse Voice'].every(t=>badges.includes(`${t}: Setup required (MODEL_API_KEY)`)),badges);
  check(`A06-${width}`,await p.locator('#thyra-typed').getAttribute('maxlength')==='160'&&await p.locator('#thyra-upload').getAttribute('accept')==='image/jpeg,image/png,image/webp');
  await p.locator('#thyra-typed').fill('a flooded cathedral at dawn '.repeat(5));
  const file=join(root,'packages/xr/public/panoramas/misty_pines.jpg'),long='a-long-real-panorama-filename-'.repeat(6)+'.jpg';
  await p.locator('#thyra-upload').setInputFiles({name:long,mimeType:'image/jpeg',buffer:readFileSync(file)});
  check(`A04-${width}`,await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  check(`A08-name-${width}`,await p.locator('#thyra-upload-name').textContent()===`${long} · your image, not generated`);
  await p.locator('#thyra-upload').setInputFiles({name:'second.jpg',mimeType:'image/jpeg',buffer:readFileSync(file)});
  const old=await p.evaluate(async()=>{const {sessionInput}=await import('/src/session-state.ts');return sessionInput.upload.url;});
  await p.locator('#thyra-upload').setInputFiles(file);
  p.__auditLabel=`revoked-url-negative-${width}`;
  const revoked=await p.evaluate(async old=>{try{await fetch(old);return false;}catch{return true;}},old);
  // A revoked object URL fetch is a deliberate negative request, never application logic.
  await p.waitForTimeout(200); p.__auditLabel=label;
  check(`A09-replace-${width}`,revoked);
  await p.locator('#thyra-upload').setInputFiles([]);check(`A09-cancel-${width}`,(await p.locator('#thyra-upload-name').textContent()).includes('misty_pines.jpg'));
  await p.screenshot({path:join(root,`audit/app/app-${width}.jpg`),type:'jpeg',quality:65});
  await p.locator('#thyra-enter').click();await p.waitForFunction(()=>document.querySelector('#thyra-hud').hidden);check(`A12-enter-${width}`,true);
  await p.evaluate(async()=>{await window.FRAMEWORK_MCP_RUNTIME.world.session.end();});
  await p.waitForFunction(()=>!document.querySelector('#thyra-hud').hidden);
  check(`A12-exit-${width}`,true);
  // Exclude only the explicitly probed revoked object URL failure.
  const bad=events.filter(e=>e.label===label&&(e.level==='error'||e.status>=400||e.type==='pageerror'||e.type==='requestfailed')&&!String(e.url??e.message).includes('blob:'));
  check(`A05-A13-${width}`,bad.length===0,bad);await ctx.close();
 }
 const p=await browser.newPage();watch(p,'static');await p.goto('http://127.0.0.1:8432/',{waitUntil:'networkidle',timeout:90000});await p.waitForFunction(()=>!!document.querySelector('#thyra-hud'));
 check('A10-static',!events.some(e=>e.label==='static'&&e.url?.includes('/api/status')));
 check('A14-desktop',await p.evaluate(()=>'IWER_DEVICE' in window));await p.close();
 const native=await browser.newPage({userAgent:'OculusBrowser/99.0 Chrome/156'});watch(native,'native');await native.goto('http://127.0.0.1:8432/',{waitUntil:'networkidle'});await native.waitForFunction(()=>!!document.querySelector('#thyra-enter'));
 const support=await native.evaluate(async()=>({emulated:'IWER_DEVICE'in window,supported:await navigator.xr?.isSessionSupported('immersive-ar'),disabled:document.querySelector('#thyra-enter').disabled,note:document.querySelector('#thyra-xr-note').textContent}));
 check('A14-native',!support.emulated,support);
 check('A11',support.supported===false&&support.disabled&&support.note==='This browser has no WebXR AR. Open it in the Quest Browser, or in desktop Chrome for the emulated room.',support);await native.close();
} finally {
 await browser.close();await Promise.all(servers.map(s=>new Promise(r=>s.close(r))));
 writeFileSync(join(root,'audit/app/pages-checks.json'),JSON.stringify({started:new Date().toISOString(),passed:checks.filter(c=>c.ok).length,failed:checks.filter(c=>!c.ok).length,checks},null,2));
 writeFileSync(join(root,'audit/app/pages-events.json'),JSON.stringify(events,null,2));
}
process.exitCode=checks.some(c=>!c.ok)?1:0;
