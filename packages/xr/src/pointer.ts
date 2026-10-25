import { type Camera, Matrix4, type Object3D, Raycaster, Vector2, Vector3, type WebGLRenderer } from '@iwsdk/core';

export type PointerKind = 'hand' | 'controller' | 'gaze' | 'mouse';

export interface Pointer {
  id: string;
  kind: PointerKind;
  origin: Vector3;
  dir: Vector3;
  down: boolean;
  pressedThisFrame: boolean;
  releasedThisFrame: boolean;
}

/**
 * One input model for everything Thyra hit-tests itself (walls, the door card):
 * WebXR target rays + select events (hands pinch, controllers trigger, glasses
 * gaze + pinch) and, outside a headset, the mouse/touch on the canvas.
 */
export class Pointers {
  readonly list: Pointer[] = [];
  /** Index fingertips in world space, for "reach through the door". */
  readonly tips: Vector3[] = [];
  private readonly selecting = new Map<XRInputSource, boolean>();
  private readonly edges = new Map<XRInputSource, { pressed: boolean; released: boolean }>();
  private session: XRSession | null = null;
  private readonly mat = new Matrix4();
  private readonly rig = new Matrix4();
  private mouse = { ndc: new Vector2(), down: false, active: false, pressed: false, released: false };
  private readonly ray = new Raycaster();
  private readonly pool: Pointer[] = [];
  private readonly tipPool: Vector3[] = [];

  constructor(canvas: HTMLCanvasElement) {
    const toNdc = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      this.mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      this.mouse.active = true;
    };
    // In the desktop emulator, IWER lays its own canvas (controller gizmos) over the app canvas during a
    // session, so the app canvas never sees the mouse. Listen on the window and take events that land on a
    // canvas over the app's rect: the app canvas itself, or the emulator's layer on top of it.
    const onCanvas = (e: PointerEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return false;
      const r = canvas.getBoundingClientRect();
      return r.width > 0 && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    };
    window.addEventListener('pointermove', (e) => {
      if (onCanvas(e)) toNdc(e);
    }, true);
    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !onCanvas(e)) return;
      toNdc(e);
      this.mouse.down = true;
      this.mouse.pressed = true;
    }, true);
    window.addEventListener('pointerup', () => {
      if (this.mouse.down) this.mouse.released = true;
      this.mouse.down = false;
    });
  }

  private bind(session: XRSession): void {
    if (this.session === session) return;
    this.session = session;
    this.selecting.clear();
    this.edges.clear();
    const start = (e: XRInputSourceEvent) => {
      this.selecting.set(e.inputSource, true);
      this.edges.set(e.inputSource, { pressed: true, released: false });
    };
    const end = (e: XRInputSourceEvent) => {
      this.selecting.set(e.inputSource, false);
      const ed = this.edges.get(e.inputSource) ?? { pressed: false, released: false };
      ed.released = true;
      this.edges.set(e.inputSource, ed);
    };
    session.addEventListener('selectstart', start);
    session.addEventListener('selectend', end);
    session.addEventListener('end', () => {
      session.removeEventListener('selectstart', start);
      session.removeEventListener('selectend', end);
      this.session = null;
    });
  }

  private take(i: number): Pointer {
    if (!this.pool[i]) this.pool[i] = { id: '', kind: 'mouse', origin: new Vector3(), dir: new Vector3(), down: false, pressedThisFrame: false, releasedThisFrame: false };
    return this.pool[i];
  }

  update(renderer: WebGLRenderer, camera: Camera, player: Object3D, session: XRSession | undefined, frame: XRFrame | null, ref: XRReferenceSpace | null): void {
    this.list.length = 0;
    this.tips.length = 0;
    let n = 0;
    if (session && frame && ref) {
      this.bind(session);
      player.updateMatrixWorld(true);
      this.rig.copy(player.matrixWorld);
      let gaze: XRInputSource | null = null;
      for (const s of session.inputSources) if (s.targetRayMode === 'gaze') gaze = s;
      let anyEdgePressed = false;
      let anyEdgeReleased = false;
      let anyDown = false;
      for (const s of session.inputSources) {
        const ed = this.edges.get(s);
        if (ed?.pressed) anyEdgePressed = true;
        if (ed?.released) anyEdgeReleased = true;
        if (this.selecting.get(s)) anyDown = true;
        if (s.hand) {
          const tipSpace = s.hand.get('index-finger-tip');
          const tip = tipSpace ? frame.getJointPose?.(tipSpace, ref) : undefined;
          if (tip) {
            const t = this.tipPool[this.tips.length] ?? (this.tipPool[this.tips.length] = new Vector3());
            const p = tip.transform.position;
            t.set(p.x, p.y, p.z).applyMatrix4(this.rig);
            this.tips.push(t);
          }
        }
        if (gaze && s !== gaze) continue; // glasses: only the gaze ray aims, any pinch selects
        const pose = frame.getPose(s.targetRaySpace, ref);
        if (!pose) continue;
        const p = this.take(n++);
        this.mat.fromArray(pose.transform.matrix).premultiply(this.rig);
        p.id = `${s.handedness}-${s.targetRayMode}`;
        p.kind = s.targetRayMode === 'gaze' ? 'gaze' : s.hand ? 'hand' : 'controller';
        p.origin.setFromMatrixPosition(this.mat);
        p.dir.set(0, 0, -1).transformDirection(this.mat);
        if (gaze) {
          p.down = anyDown;
          p.pressedThisFrame = anyEdgePressed;
          p.releasedThisFrame = anyEdgeReleased;
        } else {
          p.down = this.selecting.get(s) ?? false;
          p.pressedThisFrame = ed?.pressed ?? false;
          p.releasedThisFrame = ed?.released ?? false;
        }
        this.list.push(p);
      }
      for (const ed of this.edges.values()) {
        ed.pressed = false;
        ed.released = false;
      }
    }
    // Mouse / touch: in the 2D page, and on the desktop emulator (IWER) during a session.
    if (this.mouse.active) {
      const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
      cam.updateMatrixWorld();
      this.ray.setFromCamera(this.mouse.ndc, cam);
      const p = this.take(n++);
      p.id = 'mouse';
      p.kind = 'mouse';
      p.origin.copy(this.ray.ray.origin);
      p.dir.copy(this.ray.ray.direction);
      p.down = this.mouse.down;
      p.pressedThisFrame = this.mouse.pressed;
      p.releasedThisFrame = this.mouse.released;
      this.list.push(p);
    }
    this.mouse.pressed = false;
    this.mouse.released = false;
  }
}
