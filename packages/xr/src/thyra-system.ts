import {
  Box3,
  createSystem,
  DepthOccludable,
  OcclusionShadersMode,
  type Entity,
  Mesh,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RingGeometry,
  Vector3,
  XRMesh,
  XRPlane,
  MeshBasicMaterial,
  DoubleSide,
  Group,
  Matrix4,
} from '@iwsdk/core';
import {
  type GatewayStatus,
  type ObjectLike,
  type PlaneLike,
  type DoorRect,
  type RoomSummary,
  type StepState,
  type Vec3,
  type WallFrame,
  buildRoomSummary,
  drawRect,
  initialStep,
  insideRect,
  isVerticalPlane,
  pickWall,
  polygonArea,
  rayWall,
  rectsOverlap,
  signedDistance,
  stepIn,
  toPlane2,
  wallFrame,
} from '@thyra/room';
import { playOpen, playTear, playWhoosh } from './audio.js';
import { BRAND } from './brand.js';
import { CanvasPanel } from './canvas-panel.js';
import { Portal } from './components.js';
import { type Choice, DoorCard } from './door-card.js';
import { GatewayError, gateway } from './gateway-client.js';
import { SAMPLES, preparePanorama } from './panorama.js';
import { Pointers, type Pointer } from './pointer.js';
import { PortalView } from './portal.js';
import { sessionInput } from './session-state.js';
import { MicRecorder, browserSpeech, browserSpeechAvailable } from './voice.js';
import { lineMaterial } from './shaders.js';

const MAX_PORTALS = 3;
/** `?occlusion=0` turns real-world depth occlusion off (for comparisons). */
const OCCLUSION = new URLSearchParams(location.search).get('occlusion') !== '0';
const tuple = (v: Vector3): Vec3 => [v.x, v.y, v.z];

interface LivePortal {
  view: PortalView;
  entity: Entity;
  step: StepState;
  releasedAt: number;
  summary: RoomSummary | null;
  runId: string | null;
  record: Record<string, unknown>;
}

interface PaperWall {
  plane: PlaneLike;
  mesh: Mesh;
}

/**
 * Thyra's whole loop: read the room (planes + meshes), let a pinch-drag cut a
 * door into a wall, ask Muse Spark/Image (or use a labelled stand-in), open
 * the world behind the wall, and handle Step-in.
 */
export class ThyraSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
}) {
  private pointers!: Pointers;
  private walls: WallFrame[] = [];
  private planeIds = new WeakMap<object, string>();
  private planeSeq = 0;
  private floorY: number | null = null;
  private ceilingY: number | null = null;
  private floorArea: number | null = null;
  private objects: ObjectLike[] = [];
  private labelsSeen = new Set<string>();
  private readAccum = 1;
  private sessionTime = 0;
  private paperWalls: PaperWall[] = [];
  private paperPoints: Vector3[] = [];

  private portals: LivePortal[] = [];
  private portalSeq = 0;
  private drawing: { pointerId: string; frame: WallFrame; start: [number, number]; view: PortalView; valid: boolean; over: string | null } | null = null;
  private cardFor: LivePortal | null = null;
  private card = new DoorCard();
  private hint = new CanvasPanel('Thyra hint', 1024, 180, 0.5);
  private hintText = '';
  private hintUntil = 0;
  private reticle!: Mesh;
  private wallGlow = new Map<string, { group: Group; level: number }>();
  private status: GatewayStatus | null = null;
  private statusAge = 999;
  private mic: MicRecorder | null = null;
  private readonly raycaster = new Raycaster();
  private readonly head = new Vector3();
  private readonly tmp = new Vector3();
  private readonly box = new Box3();
  private busy = false;

  init(): void {
    this.pointers = new Pointers(this.renderer.domElement);
    this.card.panel.mesh.visible = false;
    this.hint.mesh.visible = false;
    this.scene.add(this.card.panel.mesh, this.hint.mesh);
    const ret = new Mesh(new RingGeometry(0.014, 0.022, 32), new MeshBasicMaterial({ color: BRAND.lime, transparent: true, opacity: 0.95, depthWrite: false, side: DoubleSide }));
    ret.renderOrder = 300;
    ret.visible = false;
    ret.name = 'Thyra reticle';
    this.reticle = ret;
    this.scene.add(ret);
    this.renderer.localClippingEnabled = true;
    void this.refreshStatus();
    (window as unknown as { __thyra: unknown }).__thyra = this.debugApi();
    // Angles of the door card's corners from the view axis (degrees), for the glasses FoV check.
    (window as unknown as { __thyraCardCorners: unknown }).__thyraCardCorners = () => {
      const m = this.card.panel.mesh;
      const g = (m.geometry as PlaneGeometry).parameters;
      const inv = this.player.head.matrixWorld.clone().invert();
      m.updateMatrixWorld(true);
      return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => {
        const p = new Vector3((x * g.width) / 2, (y * g.height) / 2, 0).applyMatrix4(m.matrixWorld).applyMatrix4(inv);
        return { h: (Math.atan2(p.x, -p.z) * 180) / Math.PI, v: (Math.atan2(p.y, -p.z) * 180) / Math.PI };
      });
    };
  }

  // ------------------------------------------------------------------ status

  private async refreshStatus(): Promise<void> {
    this.statusAge = 0;
    this.status = await gateway.status();
    this.card.status = this.status;
    this.card.voiceLabel = this.status?.transcribe.ready ? 'Muse Voice' : browserSpeechAvailable() ? 'browser speech (not Meta)' : 'unavailable';
    window.dispatchEvent(new CustomEvent('thyra-status', { detail: this.status }));
    if (this.card.panel.mesh.visible) this.card.draw();
  }

  // ------------------------------------------------------------------ room read

  private planeId(p: object): string {
    let id = this.planeIds.get(p);
    if (!id) {
      id = `plane-${++this.planeSeq}`;
      this.planeIds.set(p, id);
    }
    return id;
  }

  private readRoom(): void {
    const head = this.head;
    const vertical: PlaneLike[] = [];
    const horizontal: Array<{ y: number; label: string | null; area: number; up: boolean }> = [];
    for (const e of this.queries.planes.entities) {
      const raw = e.getValue(XRPlane, '_plane') as XRPlane | undefined;
      const o = e.object3D;
      if (!raw || !o) continue;
      o.updateWorldMatrix(true, false);
      const label = (raw as XRPlane & { semanticLabel?: string }).semanticLabel ?? null;
      if (label) this.labelsSeen.add(`plane:${label}`);
      const pl: PlaneLike = {
        id: this.planeId(raw),
        label,
        orientation: (raw.orientation as 'horizontal' | 'vertical' | undefined) ?? null,
        matrix: o.matrixWorld.elements,
        polygon: raw.polygon.map((p) => ({ x: p.x, z: p.z })),
      };
      if (isVerticalPlane(pl)) {
        // Walls only: door, window and wall-art planes sit on walls and would split them.
        if (label && label !== 'wall' && label !== 'other') continue;
        vertical.push(pl);
      } else {
        const y = o.matrixWorld.elements[13];
        const ny = o.matrixWorld.elements[5];
        horizontal.push({ y, label, area: polygonArea(pl.polygon), up: ny > 0 });
      }
    }
    for (const pw of this.paperWalls) vertical.push(pw.plane);
    this.walls = vertical.map((p) => wallFrame(p, tuple(head)));
    // floor: the plane labelled floor, else the lowest horizontal plane below the head
    const below = horizontal.filter((h) => h.y < head.y - 0.5);
    const floor = below.find((h) => h.label === 'floor') ?? below.sort((a, b) => a.y - b.y)[0];
    this.floorY = floor ? floor.y : null;
    this.floorArea = floor ? floor.area : null;
    const above = horizontal.filter((h) => h.y > head.y + 0.1);
    const ceiling = above.find((h) => h.label === 'ceiling') ?? above.sort((a, b) => a.y - b.y)[0];
    this.ceilingY = ceiling ? ceiling.y : null;
    const objs: ObjectLike[] = [];
    for (const e of this.queries.meshes.entities) {
      const label = e.getValue(XRMesh, 'semanticLabel') as string;
      const bounded = e.getValue(XRMesh, 'isBounded3D') as boolean;
      if (!bounded || !label || !e.object3D) continue;
      this.labelsSeen.add(`mesh:${label}`);
      this.box.setFromObject(e.object3D);
      const c = this.box.getCenter(new Vector3());
      const s = this.box.getSize(new Vector3());
      // dims as [width, height, depth]
      objs.push({ label, center: tuple(c), dims: [Math.max(s.x, s.z), s.y, Math.min(s.x, s.z)] });
    }
    this.objects = objs;
    this.syncWallGlows();
  }

  /** Hairline frames along each wall, shown when a ray crosses that wall. */
  private syncWallGlows(): void {
    const ids = new Set(this.walls.map((w) => w.planeId));
    for (const [id, g] of this.wallGlow) if (!ids.has(id)) {
      g.group.removeFromParent();
      this.wallGlow.delete(id);
    }
    for (const w of this.walls) {
      let g = this.wallGlow.get(w.planeId);
      if (!g) {
        const group = new Group();
        group.matrixAutoUpdate = false;
        const mat = lineMaterial(BRAND.lime, 0);
        for (let i = 0; i < 4; i++) {
          const m = new Mesh(new PlaneGeometry(1, 1), mat);
          m.renderOrder = 120;
          group.add(m);
        }
        group.name = `Wall outline ${w.planeId}`;
        this.scene.add(group);
        g = { group, level: 0 };
        this.wallGlow.set(w.planeId, g);
      }
      const m = new Matrix4().makeBasis(new Vector3(...w.u), new Vector3(...w.v), new Vector3(...w.n));
      m.setPosition(new Vector3(...w.origin));
      g.group.matrix.copy(m);
      g.group.updateMatrixWorld(true);
      const b = w.bounds;
      const t = 0.006;
      const [top, bottom, left, right] = g.group.children as Mesh[];
      const cu = (b.u0 + b.u1) / 2;
      const cv = (b.v0 + b.v1) / 2;
      top.position.set(cu, b.v1 - t, 0.008);
      top.scale.set(b.u1 - b.u0, t, 1);
      bottom.position.set(cu, b.v0 + t, 0.008);
      bottom.scale.set(b.u1 - b.u0, t, 1);
      left.position.set(b.u0 + t, cv, 0.008);
      left.scale.set(t, b.v1 - b.v0, 1);
      right.position.set(b.u1 - t, cv, 0.008);
      right.scale.set(t, b.v1 - b.v0, 1);
    }
  }

  // ------------------------------------------------------------------ frame

  update(dt: number): void {
    const session = this.world.session;
    this.player.head.getWorldPosition(this.head);
    this.statusAge += dt;
    if (this.statusAge > 20) void this.refreshStatus();
    if (!session) {
      this.sessionTime = 0;
      return;
    }
    this.sessionTime += dt;
    this.readAccum += dt;
    if (this.readAccum > 0.5) {
      this.readAccum = 0;
      this.readRoom();
    }
    this.pointers.update(this.renderer, this.camera, this.player, session, this.world.xrFrame, this.world.xrReferenceSpace);
    this.handleHints();
    let hoverWall: string | null = null;
    let reticleSet = false;
    for (const p of this.pointers.list) {
      if (this.handleCard(p)) continue;
      if (this.drawing && this.drawing.pointerId === p.id) {
        this.continueDraw(p);
        continue;
      }
      if (this.isInside()) continue;
      const hit = pickWall(this.walls, tuple(p.origin), tuple(p.dir));
      if (hit) {
        hoverWall = hit.frame.planeId;
        if (!reticleSet) {
          reticleSet = true;
          this.reticle.visible = true;
          this.reticle.position.set(...hit.hit.point).addScaledVector(new Vector3(...hit.frame.n), 0.01);
          this.reticle.lookAt(this.tmp.set(...hit.hit.point).add(new Vector3(...hit.frame.n)));
        }
        if (p.pressedThisFrame && !this.drawing) this.startDraw(p, hit.frame, hit.hit.uv);
      } else if (p.pressedThisFrame && this.walls.length === 0 && this.sessionTime > 5) {
        this.paperPoint(p);
      }
    }
    if (!reticleSet) this.reticle.visible = false;
    for (const [id, g] of this.wallGlow) {
      const target = id === hoverWall || this.drawing?.frame.planeId === id ? 0.65 : 0;
      g.level += (target - g.level) * Math.min(1, dt * 8);
      ((g.group.children[0] as Mesh).material as MeshBasicMaterial).opacity = g.level;
      g.group.visible = g.level > 0.01 && !this.isInside();
    }
    for (const lp of this.portals) this.updatePortal(lp, dt);
    this.updateCardPlacement(dt);
  }

  private isInside(): boolean {
    return this.portals.some((p) => p.step.mode !== 'room');
  }

  // ------------------------------------------------------------------ drawing

  private startDraw(p: Pointer, frame: WallFrame, uv: [number, number]): void {
    const view = new PortalView(++this.portalSeq, frame, this.floorY);
    view.addTo(this.scene);
    this.drawing = { pointerId: p.id, frame, start: uv, view, valid: false, over: null };
    this.hintUntil = 0;
    view.setRect({ u0: uv[0], u1: uv[0], v0: uv[1], v1: uv[1] }, false);
  }

  /** The tag of an open door on the same wall that `rect` would overlap, if any. */
  private overlapping(planeId: string, rect: DoorRect): string | null {
    const other = this.portals.find((lp) => lp.view.frame.planeId === planeId && rectsOverlap(lp.view.rect, rect));
    return other ? other.view.tag : null;
  }

  private floorV(frame: WallFrame): number | null {
    return this.floorY === null ? null : this.floorY - frame.origin[1];
  }

  private continueDraw(p: Pointer): void {
    const d = this.drawing!;
    const hit = rayWall(d.frame, tuple(p.origin), tuple(p.dir));
    if (hit) {
      const r = drawRect(d.start, hit.uv, d.frame.bounds, { floorV: this.floorV(d.frame) });
      d.over = this.overlapping(d.frame.planeId, r.rect);
      d.valid = r.valid && !d.over;
      d.view.setRect(r.rect, d.valid);
    }
    if (p.releasedThisFrame || !p.down) this.endDraw();
  }

  private endDraw(): void {
    const d = this.drawing!;
    this.drawing = null;
    if (!d.valid) {
      d.view.dispose();
      this.portalSeq--;
      this.toast(
        d.over
          ? `That overlaps ${d.over}. Draw the new door beside it.`
          : 'Too small: a door needs at least 0.40 × 0.60 m. Pinch and drag again.',
      );
      return;
    }
    if (this.portals.length >= MAX_PORTALS) this.closePortal(this.portals[0]);
    d.view.finalize();
    playTear();
    const corners = d.view.corners();
    const offPlane = Math.max(...corners.map((c) => Math.abs(signedDistance(d.frame, tuple(c)))));
    const entity = this.world.createTransformEntity(d.view.local);
    entity.addComponent(Portal, {
      tag: d.view.tag,
      state: 'framed',
      planeId: d.frame.planeId,
      widthM: d.view.width,
      heightM: d.view.height,
      offPlaneM: offPlane,
      stencilRef: d.view.stencilRef,
    });
    // Real objects in front of the wall (a couch, your hand) hide the door where depth is available.
    if (OCCLUSION) {
      const occ = this.world.createTransformEntity(d.view.occludable, { parent: entity });
      occ.addComponent(DepthOccludable, { mode: OcclusionShadersMode.HardOcclusion });
    }
    const lp: LivePortal = { view: d.view, entity, step: initialStep(), releasedAt: performance.now(), summary: null, runId: null, record: {} };
    this.portals.push(lp);
    this.openCard(lp);
  }

  // ------------------------------------------------------------------ paper wall

  private paperPoint(p: Pointer): void {
    // a point on the floor where the ray lands, else 1.5 m ahead at floor height
    const fy = this.floorY ?? this.head.y - 1.6;
    let pt: Vector3;
    if (p.dir.y < -0.05) {
      const t = (fy - p.origin.y) / p.dir.y;
      pt = p.origin.clone().addScaledVector(p.dir, Math.min(t, 6));
    } else pt = p.origin.clone().addScaledVector(p.dir, 1.5);
    pt.y = fy;
    this.paperPoints.push(pt);
    if (this.paperPoints.length < 2) {
      this.toast('First corner set. Pinch where the paper wall should end.');
      return;
    }
    const [a, b] = this.paperPoints.splice(0, 2);
    const width = a.distanceTo(b);
    if (width < 0.5) {
      this.toast('Too narrow for a paper wall. Pinch two points at least 0.5 m apart.');
      return;
    }
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const along = b.clone().sub(a).normalize();
    let n = new Vector3(-along.z, 0, along.x);
    if (n.dot(this.head.clone().sub(mid)) < 0) n.negate();
    const h = 2.4;
    const centre = mid.clone().setY(fy + h / 2);
    // plane space: Y = normal, X = along, Z = X × Y
    const x = along.clone();
    const z = x.clone().cross(n);
    const m = new Matrix4().makeBasis(x, n, z).setPosition(centre);
    const plane: PlaneLike = {
      id: `paper-${this.paperWalls.length + 1}`,
      label: 'paper wall (virtual)',
      orientation: 'vertical',
      matrix: m.elements,
      polygon: [
        { x: -width / 2, z: -h / 2 },
        { x: width / 2, z: -h / 2 },
        { x: width / 2, z: h / 2 },
        { x: -width / 2, z: h / 2 },
      ],
    };
    const mesh = new Mesh(new PlaneGeometry(width, h), new MeshBasicMaterial({ color: BRAND.plaster, transparent: true, opacity: 0.55, side: DoubleSide, depthWrite: false }));
    mesh.position.copy(centre).addScaledVector(n, -0.01);
    mesh.lookAt(centre.clone().add(n));
    mesh.renderOrder = 1;
    mesh.name = 'Paper wall (virtual)';
    this.scene.add(mesh);
    this.paperWalls.push({ plane, mesh });
    this.readRoom();
    this.toast('Paper wall placed (virtual, not your wall). Pinch on it and drag a door.');
  }

  // ------------------------------------------------------------------ hints

  private toast(text: string, seconds = 4): void {
    this.hintText = text;
    this.hintUntil = this.sessionTime + seconds;
    this.drawHint();
  }

  private drawHint(): void {
    const p = this.hint;
    p.regions = [];
    p.clear('rgba(23,22,20,0.82)', 40);
    p.para(this.hintText, 44, 78, 40, 936, 52, { weight: 500, maxLines: 2 });
    p.commit();
  }

  private handleHints(): void {
    let text = '';
    if (this.portals.length === 0 && !this.drawing) {
      if (this.walls.length === 0 && this.sessionTime > 5)
        text = this.paperPoints.length ? 'First corner set. Pinch where the paper wall should end.' : 'No walls found. Run Space Setup, or pinch two points to place a paper wall.';
      else if (this.walls.length > 0) text = 'Pinch your wall and drag a door open.';
    }
    if (this.sessionTime < this.hintUntil) text = this.hintText;
    if (text !== this.hintText || (text && !this.hint.mesh.visible)) {
      this.hintText = text;
      if (text) this.drawHint();
    }
    this.hint.mesh.visible = Boolean(text) && !this.isInside();
    if (this.hint.mesh.visible) {
      // float low in the view, lazily following the head
      const fwd = new Vector3(0, 0, -1).applyQuaternion(this.player.head.getWorldQuaternion(new Quaternion()));
      fwd.y = 0;
      fwd.normalize();
      const target = this.head.clone().addScaledVector(fwd, 0.85);
      target.y = this.head.y - 0.22;
      if (this.hint.mesh.position.distanceTo(target) > 0.35 || this.hint.mesh.position.lengthSq() === 0) this.hint.mesh.position.copy(target);
      this.hint.mesh.lookAt(this.head);
    }
  }

  // ------------------------------------------------------------------ door card

  private openCard(lp: LivePortal): void {
    this.cardFor = lp;
    this.card.tag = lp.view.tag;
    this.card.dims = `${lp.view.width.toFixed(2)} × ${lp.view.height.toFixed(2)} m`;
    this.card.view = { kind: 'choose' };
    this.card.draw();
    this.card.panel.mesh.visible = true;
    this.placeCard(lp, true);
  }

  private placeCard(lp: LivePortal, snap: boolean): void {
    const v = lp.view;
    const f = v.frame;
    const m = this.card.panel.mesh;
    const glasses = this.pointers.list.some((p) => p.kind === 'gaze');
    let target: Vector3;
    if (glasses) {
      // Meta VR Glasses: narrow view (±37°, +25°/−43°), so the card sits low and central.
      const centre = new Vector3(...f.origin).addScaledVector(new Vector3(...f.u), (v.rect.u0 + v.rect.u1) / 2);
      const dir = centre.sub(this.head).setY(0).normalize();
      target = this.head.clone().addScaledVector(dir, 0.9);
      target.y = this.head.y - 0.42;
    } else {
      // Quest: beside the door, about a metre from your eyes, clear of the opening.
      const edgeU = v.rect.u1;
      const edge = new Vector3(...f.origin).addScaledVector(new Vector3(...f.u), edgeU).addScaledVector(new Vector3(...f.v), v.rect.v1 - 0.4);
      const dir = edge.sub(this.head).setY(0).normalize();
      const halfAngle = Math.atan2(0.28, 0.95) + 0.08;
      dir.applyAxisAngle(new Vector3(0, 1, 0), -halfAngle);
      target = this.head.clone().addScaledVector(dir, 0.95);
      target.y = this.head.y - 0.14;
    }
    if (snap || m.position.distanceTo(target) > 0.6) m.position.copy(target);
    else m.position.lerp(target, 0.04);
    m.lookAt(this.head);
  }

  private updateCardPlacement(_dt: number): void {
    const lp = this.cardFor;
    const m = this.card.panel.mesh;
    m.visible = Boolean(lp) && !this.isInside();
    if (lp && m.visible) this.placeCard(lp, false);
  }

  /** Returns true when the pointer is on the card (so it doesn't also draw on the wall). */
  private handleCard(p: Pointer): boolean {
    const m = this.card.panel.mesh;
    if (!m.visible || this.drawing) return false;
    this.raycaster.set(p.origin, p.dir);
    const hit = this.raycaster.intersectObject(m, false)[0];
    if (!hit?.uv) {
      if (this.card.panel.hover && p.kind !== 'mouse') {
        this.card.panel.hover = null;
        this.card.draw();
      }
      return false;
    }
    const id = this.card.panel.regionAt(hit.uv);
    if (id !== this.card.panel.hover) {
      this.card.panel.hover = id;
      this.card.draw();
    }
    if (p.pressedThisFrame && id) this.onCardAction(id);
    // Only buttons capture the ray; a pinch on the card's background passes through to the wall.
    return id !== null;
  }

  private onCardAction(id: string): void {
    const lp = this.cardFor;
    if (!lp || this.busy) return;
    if (id === 'close') return this.closePortal(lp);
    if (id === 'again') {
      this.card.view = { kind: 'choose' };
      this.card.draw();
      return;
    }
    if (id === 'mic') return void this.voice(lp);
    const choice = this.card.choices().find((c) => c.id === id);
    if (choice) void this.openWorld(lp, choice);
  }

  private async voice(lp: LivePortal): Promise<void> {
    if (this.mic?.recording) {
      const wav = await this.mic.stop();
      this.card.view = { kind: 'working', summary: this.summarize(lp, '…'), step: 'Muse Voice Transcribe is listening back', note: null, rationale: null };
      this.card.draw();
      try {
        const r = await gateway.transcribe(wav);
        if (!r.text.trim()) throw new Error('Nothing heard.');
        await this.openWorld(lp, { id: 'voice', destination: r.text.trim(), sampleId: null, upload: false });
      } catch (err) {
        this.card.view = { kind: 'error', message: err instanceof Error ? err.message : String(err) };
        this.card.draw();
      }
      return;
    }
    if (this.status?.transcribe.ready) {
      try {
        this.mic = new MicRecorder();
        await this.mic.start();
        this.card.view = { kind: 'listening', via: 'Muse Voice Transcribe via your gateway. Pinch Done when finished.' };
      } catch (err) {
        this.card.view = { kind: 'error', message: `Microphone: ${(err as Error).message}` };
      }
      this.card.draw();
      return;
    }
    if (!browserSpeechAvailable()) {
      this.card.view = { kind: 'error', message: 'Voice needs MODEL_API_KEY on the gateway (Muse Voice Transcribe), and this browser has no speech recognition of its own.' };
      this.card.draw();
      return;
    }
    this.card.view = { kind: 'listening', via: 'Browser speech recognition, not a Meta model. Audio goes to your browser’s speech service.' };
    this.card.draw();
    const r = await browserSpeech();
    if (!r.ok) {
      this.card.view = { kind: 'error', message: r.reason };
      this.card.draw();
      return;
    }
    // Without the key the words still drive the room read; the image is a labelled stand-in.
    await this.openWorld(lp, { id: 'voice', destination: r.text, sampleId: sessionInput.upload ? null : SAMPLES[0].id, upload: Boolean(sessionInput.upload) && !this.card.keyReady });
  }

  private summarize(lp: LivePortal, destination: string): RoomSummary {
    return buildRoomSummary({
      frame: lp.view.frame,
      rect: lp.view.rect,
      head: tuple(this.head),
      floorY: this.floorY,
      ceilingY: this.ceilingY,
      floorArea: this.floorArea,
      objects: this.objects,
      now: new Date(),
      destination,
    });
  }

  // ------------------------------------------------------------------ the pipeline

  private setState(lp: LivePortal, state: string): void {
    lp.entity.setValue(Portal, 'state', state);
  }

  private async openWorld(lp: LivePortal, choice: Choice): Promise<void> {
    this.busy = true;
    const t0 = lp.releasedAt;
    const summary = this.summarize(lp, choice.destination);
    lp.summary = summary;
    lp.entity.setValue(Portal, 'destination', choice.destination);
    const record: Record<string, unknown> = { tag: lp.view.tag, destination: choice.destination, room: summary, models: {} };
    lp.record = record;
    try {
      let url: string;
      let source: 'muse-image-1.0' | 'user-upload' | 'cc0-sample';
      let title = choice.destination;
      let rationale: string | null = null;
      let planNote: string | null = null;
      let stamp: string | null = null;
      let credit: string | null = null;
      const generate = choice.sampleId === null && !choice.upload;
      this.setState(lp, 'planning');
      lp.view.setPhase('planning');
      if (generate) {
        this.card.view = { kind: 'working', summary, step: 'Muse Spark is reading the room…', note: null, rationale: null };
        this.card.draw();
        const planned = await gateway.plan(summary, choice.destination);
        lp.runId = planned.run_id;
        rationale = planned.plan.rationale;
        title = planned.plan.title;
        lp.view.setColours(planned.plan.ambient_spill.hex, planned.plan.frame_trim.hex, planned.plan.ambient_spill.intensity, true);
        record.timings_plan_ms = Math.round(performance.now() - t0);
        this.setState(lp, 'painting');
        lp.view.setPhase('painting');
        this.card.view = { kind: 'working', summary, step: 'Muse Image is painting the world…', note: null, rationale };
        this.card.draw();
        const pano = await gateway.panorama(planned.run_id);
        url = gateway.imageUrl(pano.image_url);
        source = 'muse-image-1.0';
        record.timings_image_ms = Math.round(performance.now() - t0);
      } else {
        planNote = 'No plan: Muse Spark needs MODEL_API_KEY (Setup required). Defaults: eye-level horizon, neutral trim.';
        this.card.view = { kind: 'working', summary, step: 'Setup required: Muse Spark', note: 'The room read above is real; without MODEL_API_KEY no plan is made and no image is generated.', rationale: null };
        this.card.draw();
        this.setState(lp, 'painting');
        lp.view.setPhase('painting');
        if (choice.upload && sessionInput.upload) {
          url = sessionInput.upload.url;
          source = 'user-upload';
          stamp = 'Your image, not generated';
          title = sessionInput.upload.name;
        } else {
          const s = SAMPLES.find((x) => x.id === choice.sampleId) ?? SAMPLES[0];
          url = `${import.meta.env.BASE_URL}${s.file}`;
          source = 'cc0-sample';
          stamp = 'Sample, not generated';
          credit = `${s.title} · ${s.credit}`;
          title = s.title;
          record.sample_id = s.id;
        }
        // give the room read a moment on screen before the world replaces it
        await new Promise((r) => setTimeout(r, 900));
      }
      const pano = await preparePanorama(url);
      const eyeHeight = this.floorY === null ? 1.6 : this.head.y - this.floorY;
      lp.view.setWorld(pano.texture, pano.mode, this.head.clone(), eyeHeight, pano.analysis.horizon_hex);
      playOpen();
      const timeToWorld = Math.round(performance.now() - t0);
      this.setState(lp, 'open');
      lp.entity.setValue(Portal, 'source', source);
      lp.entity.setValue(Portal, 'panoMode', pano.mode);
      Object.assign(record, { source, stamp, pano_mode: pano.mode, analysis: pano.analysis, time_to_world_ms: timeToWorld, decode_ms: pano.decodeMs });
      this.card.view = { kind: 'open', title, rationale, stamp, credit, mode: pano.mode, analysis: pano.analysis, timeToWorldMs: timeToWorld, planNote };
      this.card.draw();
      void this.recordRun(lp, source, pano, timeToWorld);
    } catch (err) {
      const message =
        err instanceof GatewayError
          ? err.setupRequired
            ? 'Setup required: MODEL_API_KEY is not set on the gateway.'
            : err.body.refused
              ? `Muse Spark declined: ${String(err.body.reason)}`
              : `${String(err.body.error ?? 'error')}: ${err.message}${err.body.request_id ? ` (request ${String(err.body.request_id)})` : ''}`
          : err instanceof Error
            ? err.message
            : String(err);
      record.error = message;
      this.setState(lp, 'error');
      lp.view.setPhase('error');
      this.card.view = { kind: 'error', message };
      this.card.draw();
    } finally {
      this.busy = false;
    }
  }

  private async recordRun(lp: LivePortal, source: string, pano: { analysis: unknown; mode: string; width: number; height: number }, timeToWorld: number): Promise<void> {
    try {
      if (!this.status) return; // gateway offline: the record stays in the page (window.__thyra)
      let id = lp.runId;
      if (!id && (source === 'cc0-sample' || source === 'user-upload')) {
        id = (await gateway.createRun(lp.summary!, String(lp.record.destination), source, (lp.record.sample_id as string) ?? null)).id;
        lp.runId = id;
      }
      if (id) await gateway.patchRun(id, { pano: { ...(pano.analysis as object), pano_mode: pano.mode }, timings: { time_to_world_ms: timeToWorld }, width: pano.width, height: pano.height });
      lp.record.run_id = id;
    } catch (err) {
      lp.record.record_error = (err as Error).message;
    }
  }

  private closePortal(lp: LivePortal): void {
    lp.view.dispose();
    lp.entity.dispose();
    this.portals = this.portals.filter((p) => p !== lp);
    if (this.cardFor === lp) {
      this.cardFor = null;
      this.card.panel.mesh.visible = false;
    }
  }

  // ------------------------------------------------------------------ per-portal frame

  private updatePortal(lp: LivePortal, dt: number): void {
    const v = lp.view;
    v.update(dt, this.head, this.floorY);
    if (v.phase !== 'open') return;
    const f = v.frame;
    const headDistance = signedDistance(f, tuple(this.head));
    const headInDoor = insideRect(v.rect, toPlane2(f, tuple(this.head)), 0.1);
    let handThrough = false;
    for (const tip of this.pointers.tips) {
      const t = tuple(tip);
      if (signedDistance(f, t) < -0.03 && insideRect(v.rect, toPlane2(f, t))) handThrough = true;
    }
    const before = lp.step.mode;
    lp.step = stepIn(lp.step, { dt, head: tuple(this.head), headDistance, headInDoor, handThrough });
    if (before !== lp.step.mode) {
      lp.entity.setValue(Portal, 'stepMode', lp.step.mode);
      if (lp.step.mode === 'entering') {
        playWhoosh();
        v.placeBackDoor(this.head.clone(), this.floorY);
      }
    }
    v.floodT = lp.step.t;
    v.inside = lp.step.mode === 'inside';
  }

  // ------------------------------------------------------------------ test/debug surface

  private debugApi() {
    const self = this;
    return {
      snapshot() {
        return {
          session: Boolean(self.world.session),
          walls: self.walls.map((w) => ({ id: w.planeId, label: w.label, origin: w.origin, n: w.n, bounds: w.bounds })),
          floorY: self.floorY,
          ceilingY: self.ceilingY,
          floorArea: self.floorArea,
          objects: self.objects,
          labelsSeen: [...self.labelsSeen],
          head: tuple(self.head),
          drawing: Boolean(self.drawing),
          pointers: self.pointers.list.map((p) => ({ id: p.id, kind: p.kind, origin: tuple(p.origin), dir: tuple(p.dir), down: p.down })),
          hint: self.hint.mesh.visible ? self.hintText : null,
          card: self.card.panel.mesh.visible ? { view: self.card.view.kind, regions: self.card.panel.regions.map((r) => r.id) } : null,
          status: self.status,
          portals: self.portals.map((p) => ({
            tag: p.view.tag,
            phase: p.view.phase,
            planeId: p.view.frame.planeId,
            rect: p.view.rect,
            width: p.view.width,
            height: p.view.height,
            corners: p.view.corners().map(tuple),
            step: p.step.mode,
            flood: p.step.t,
            summary: p.summary,
            record: p.record,
          })),
        };
      },
      /** World position of a door-card button (for aiming emulated hands in e2e). */
      cardTarget(id: string): Vec3 | null {
        const r = self.card.panel.regions.find((x) => x.id === id);
        const m = self.card.panel.mesh;
        if (!r || !m.visible) return null;
        const cw = self.card.panel.canvas.width;
        const ch = self.card.panel.canvas.height;
        const geo = (m.geometry as PlaneGeometry).parameters;
        const lx = ((r.x + r.w / 2) / cw - 0.5) * geo.width;
        const ly = (0.5 - (r.y + r.h / 2) / ch) * geo.height;
        m.updateMatrixWorld(true);
        return tuple(new Vector3(lx, ly, 0).applyMatrix4(m.matrixWorld));
      },
      /** Canvas pixel of a world point as the (left-eye) XR camera sees it, for pixel checks. */
      project(p: Vec3): [number, number] | null {
        const xrCam = self.renderer.xr.isPresenting ? self.renderer.xr.getCamera() : self.camera;
        const cam = 'cameras' in xrCam && (xrCam as { cameras: unknown[] }).cameras.length ? (xrCam as unknown as { cameras: typeof self.camera[] }).cameras[0] : self.camera;
        const v = new Vector3(...p).project(cam);
        if (v.z > 1) return null;
        const c = self.renderer.domElement;
        return [((v.x + 1) / 2) * c.clientWidth, ((1 - v.y) / 2) * c.clientHeight];
      },
      /** Room switching in the emulator (IWER SEM): a built-in id, one of our GLTS rooms, or 'none'. */
      async loadRoom(id: string): Promise<boolean> {
        const sem = (window as unknown as { IWER_DEVICE?: { sem?: { deleteAll(): void; addEnvironment(id: string, url: string): void; loadDefaultEnvironment(id: string): Promise<void> } } }).IWER_DEVICE?.sem;
        if (!sem) return false;
        for (const p of [...self.portals]) self.closePortal(p);
        if (id === 'none') {
          sem.deleteAll();
          return true;
        }
        if (id.startsWith('thyra_')) {
          try {
            sem.addEnvironment(id, new URL(`${import.meta.env.BASE_URL}rooms/${id}.glts`, location.href).href);
          } catch {
            // already registered
          }
        }
        await sem.loadDefaultEnvironment(id);
        return true;
      },
      /** World point on a wall at plane coords (u, v) for aiming. */
      wallPoint(planeId: string, u: number, v: number): Vec3 | null {
        const w = self.walls.find((x) => x.planeId === planeId);
        if (!w) return null;
        return [w.origin[0] + w.u[0] * u + w.v[0] * v, w.origin[1] + w.u[1] * u + w.v[1] * v, w.origin[2] + w.u[2] * u + w.v[2] * v];
      },
    };
  }
}

export type { Object3D };
