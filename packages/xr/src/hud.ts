import { type GatewayStatus, badges } from '@thyra/room';
import type { World } from '@iwsdk/core';
import { sessionInput } from './session-state.js';

/**
 * The 2D page around the canvas (before entering the headset session): brand,
 * one action, optional words and your own photo, and honest model status.
 */
export function mountHud(world: World): void {
  const root = document.createElement('div');
  root.id = 'thyra-hud';
  // IWER (the emulator) spoofs a Quest user agent, so detect it by its global first.
  const emulated = 'IWER_DEVICE' in window;
  root.classList.toggle('emulated', emulated);
  const quest = !emulated && /OculusBrowser/.test(navigator.userAgent);
  root.innerHTML = `
  <header class="bar">
    <div class="mark">THYRA <span>θύρα · door</span></div>
    <a class="link" href="https://github.com/nickthelegend" rel="noreferrer">MIT · source</a>
  </header>
  <main class="sheet">
    <section class="copy">
      <p class="eyebrow">P-01 · mixed reality · Quest 3 / 3S${emulated ? ' · emulator' : ''}</p>
      <h1>Open a door<br/>in your own wall.</h1>
      <p class="lede">Pinch a real wall and drag a door open. Say where it leads. Muse Spark reads your room's measurements and Muse Image paints the world behind the wall, with head-tracked parallax. Walk up to step through.</p>
      <div class="actions">
        <button id="thyra-enter" class="cta" type="button">${quest ? 'Enter mixed reality' : 'Enter the emulated room'}</button>
        <span id="thyra-xr-note" class="note">${quest ? 'Passthrough, your walls (Space Setup needed).' : 'Emulated room (IWER), not your room. On a Quest, open this page in the Quest Browser.'}</span>
      </div>
      <form class="inputs" onsubmit="return false">
        <label>Where should it lead?
          <input id="thyra-typed" type="text" maxlength="160" placeholder="a flooded cathedral at dawn" autocomplete="off"/>
        </label>
        <label class="file">Your own 2:1 panorama (optional)
          <input id="thyra-upload" type="file" accept="image/jpeg,image/png,image/webp"/>
          <span id="thyra-upload-name" class="stamp" hidden></span>
        </label>
      </form>
      <ul id="thyra-badges" class="badges" aria-live="polite"><li class="b offline">checking the gateway…</li></ul>
    </section>
    <aside class="drawing" aria-hidden="true">
      <svg viewBox="0 0 320 380" class="elev">
        <rect x="20" y="20" width="280" height="330" class="wall"/>
        <rect x="100" y="110" width="120" height="240" class="door"/>
        <line x1="100" y1="88" x2="220" y2="88" class="dim"/><line x1="100" y1="80" x2="100" y2="104" class="dim"/><line x1="220" y1="80" x2="220" y2="104" class="dim"/>
        <text x="160" y="80" class="t">1.20</text>
        <line x1="244" y1="110" x2="244" y2="350" class="dim"/><line x1="236" y1="110" x2="252" y2="110" class="dim"/><line x1="236" y1="350" x2="252" y2="350" class="dim"/>
        <text x="262" y="236" class="t">2.05</text>
        <text x="106" y="128" class="tag">P-01</text>
      </svg>
      <dl class="titleblock">
        <div><dt>project</dt><dd>THYRA</dd></div>
        <div><dt>sheet</dt><dd>XR-01</dd></div>
        <div><dt>scale</dt><dd>1:20</dd></div>
        <div><dt>event</dt><dd>Meta AI Hackathon 2026</dd></div>
      </dl>
    </aside>
  </main>`;
  document.body.appendChild(root);

  const enter = root.querySelector<HTMLButtonElement>('#thyra-enter')!;
  enter.addEventListener('click', () => world.launchXR());
  void navigator.xr?.isSessionSupported('immersive-ar').then((ok) => {
    if (!ok) {
      enter.disabled = true;
      root.querySelector('#thyra-xr-note')!.textContent = 'This browser has no WebXR AR. Open it in the Quest Browser, or in desktop Chrome for the emulated room.';
    }
  });
  const typed = root.querySelector<HTMLInputElement>('#thyra-typed')!;
  typed.addEventListener('input', () => (sessionInput.typed = typed.value.trim()));
  const upload = root.querySelector<HTMLInputElement>('#thyra-upload')!;
  const name = root.querySelector<HTMLSpanElement>('#thyra-upload-name')!;
  upload.addEventListener('change', () => {
    const f = upload.files?.[0];
    if (!f) return;
    if (sessionInput.upload) URL.revokeObjectURL(sessionInput.upload.url);
    sessionInput.upload = { url: URL.createObjectURL(f), name: f.name.replace(/\.[^.]+$/, '') };
    name.hidden = false;
    name.textContent = `${f.name} · your image, not generated`;
  });

  const list = root.querySelector<HTMLUListElement>('#thyra-badges')!;
  window.addEventListener('thyra-status', (e) => {
    const s = (e as CustomEvent<GatewayStatus | null>).detail;
    list.innerHTML = badges(s, ['spark', 'image', 'transcribe'])
      .map((b) => `<li class="b ${b.tone}">${b.text}</li>`)
      .join('');
  });
  world.visibilityState.subscribe((v) => {
    root.hidden = v !== 'non-immersive';
  });
}
