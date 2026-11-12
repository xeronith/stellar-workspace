import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import type { DirNode, FileNode, WorkspaceData } from '../src/types';
import { CATEGORY_HEX, categoryOf } from './fileColors';

export type HoverInfo = { kind: 'dir'; node: DirNode } | { kind: 'file'; node: FileNode };

export interface SceneCallbacks {
  onHover: (info: HoverInfo | null, x: number, y: number) => void;
  onSelectDir: (node: DirNode) => void;
  onClearSelection: () => void;
  onOpenFile: (node: FileNode) => void;
  onFps?: (fps: number) => void;
}

interface Placement {
  node: DirNode;
  depth: number;
  pos: THREE.Vector3;
  radius: number;
  scale: number;
  color: number;
  angle: number;
  start: number;
  end: number;
  ownStart: number;
  ownEnd: number;
}

interface Visual {
  placement: Placement;
  group: THREE.Group;
  edges: THREE.LineSegments;
  spawnAt: number;
  hover: number;
}

interface Pulse {
  curve: THREE.QuadraticBezierCurve3;
  u: number;
  speed: number;
}

interface FlyState {
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  fromCam: THREE.Vector3;
  toCam: THREE.Vector3;
  start: number;
  duration: number;
}

const PALETTE = [0x5ceaff, 0xff64d8, 0xb8ff5e, 0xffc857, 0xa78bfa, 0x5ceaff];
const PULSE_COUNT = 26;

const easeOutCubic = (x: number): number => 1 - Math.pow(1 - x, 3);
const easeInOutCubic = (x: number): number =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

export class StellarScene {
  private readonly canvas: HTMLCanvasElement;
  private readonly callbacks: SceneCallbacks;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly world = new THREE.Group();
  private readonly content = new THREE.Group();
  private readonly glowTexture: THREE.Texture;
  private readonly selectionMesh: THREE.LineSegments;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly clock = new THREE.Clock();

  private visuals: Visual[] = [];
  private crystalMeshes: THREE.Mesh[] = [];
  private fileMeta: FileNode[] = [];
  private filesPoints: THREE.Points | null = null;
  private connectionMaterials: THREE.LineBasicMaterial[] = [];
  private curves: THREE.QuadraticBezierCurve3[] = [];
  private labelTextures: THREE.Texture[] = [];
  private pulses: Pulse[] = [];
  private pulsePoints: THREE.Points | null = null;
  private pulsePositions: Float32Array | null = null;
  private rootRings: THREE.Mesh[] = [];
  private scanRing: THREE.Mesh | null = null;

  private hovered: Placement | null = null;
  private selectionBaseScale = 1;
  private buildTime = 0;
  private elapsed = 0;

  private homeTarget = new THREE.Vector3(0, -5, 0);
  private homeCam = new THREE.Vector3(34, 30, 48);
  private fly: FlyState | null = null;
  private pointerDown: { x: number; y: number } | null = null;

  private animationId = 0;
  private disposed = false;
  private fpsFrames = 0;
  private fpsTime = 0;
  private readonly resizeObserver: ResizeObserver;

  constructor(canvas: HTMLCanvasElement, callbacks: SceneCallbacks) {
    this.canvas = canvas;
    this.callbacks = callbacks;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.setClearColor(0x02040a, 1);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.setSize(Math.max(canvas.clientWidth, 1), Math.max(canvas.clientHeight, 1), false);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x02040a, 0.0034);

    this.camera = new THREE.PerspectiveCamera(
      52,
      Math.max(canvas.clientWidth, 1) / Math.max(canvas.clientHeight, 1),
      0.1,
      700,
    );
    this.camera.position.copy(this.homeCam);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(this.homeTarget);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.055;
    this.controls.rotateSpeed = 0.55;
    this.controls.zoomSpeed = 0.8;
    this.controls.panSpeed = 0.6;
    this.controls.minDistance = 7;
    this.controls.maxDistance = 190;
    this.controls.maxPolarAngle = Math.PI * 0.88;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.32;

    this.glowTexture = createGlowTexture();

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(Math.max(canvas.clientWidth, 1), Math.max(canvas.clientHeight, 1)),
      0.55,
      0.5,
      0.46,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(Math.max(canvas.clientWidth, 1), Math.max(canvas.clientHeight, 1));

    this.scene.add(this.world);
    this.world.add(this.content);

    this.selectionMesh = createSelectionMesh();
    this.world.add(this.selectionMesh);

    this.buildEnvironment();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.resize();

    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerup', this.handlePointerUp);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);

    this.tick();
  }

  setData(data: WorkspaceData): void {
    this.clearContent();
    this.buildTime = this.clock.elapsedTime;
    this.hovered = null;
    this.selectionMesh.visible = false;
    this.fly = null;
    this.controls.autoRotate = true;
    this.controls.enabled = true;

    this.buildTree(data);

    this.controls.target.copy(this.homeTarget);
    this.camera.position.copy(this.homeCam);
    this.controls.update();
  }

  resetView(): void {
    this.animateCamera(this.homeTarget, this.homeCam, 1.2);
  }

  clearSelection(): void {
    this.selectionMesh.visible = false;
    this.callbacks.onClearSelection();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationId);
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.canvas.removeEventListener('pointerup', this.handlePointerUp);
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.controls.dispose();
    this.clearContent();
    disposeObject(this.world);
    this.renderer.dispose();
  }

  // ---------------------------------------------------------------- building

  private buildTree(data: WorkspaceData): void {
    const selected = selectDirs(data.root);
    const parentOf = new Map<DirNode, DirNode>();
    const placements = layoutTree(data.root, selected, parentOf);

    const placementByNode = new Map<DirNode, Placement>();
    for (const placement of placements) {
      placementByNode.set(placement.node, placement);
    }

    const octahedron = new THREE.OctahedronGeometry(1, 0);
    const edgeGeometry = new THREE.EdgesGeometry(octahedron);

    const filePositions: number[] = [];
    const fileColors: number[] = [];
    const fileMeta: FileNode[] = [];
    const depthLineMaterials = new Map<number, THREE.LineBasicMaterial>();

    placements.forEach((placement, index) => {
      const group = new THREE.Group();
      group.position.copy(placement.pos);
      group.visible = false;

      const color = new THREE.Color(placement.color);
      const fill = new THREE.Mesh(
        octahedron,
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.11,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      fill.scale.setScalar(placement.scale);
      fill.userData.placement = placement;
      group.add(fill);
      this.crystalMeshes.push(fill);

      const edges = new THREE.LineSegments(
        edgeGeometry,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.82,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      edges.scale.setScalar(placement.scale);
      group.add(edges);

      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color,
          transparent: true,
          opacity: placement.depth === 0 ? 0.3 : 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      halo.scale.setScalar(placement.scale * (placement.depth === 0 ? 6.5 : 4.2));
      group.add(halo);

      if (placement.depth === 0) {
        this.addCoreRings(group);
      }

      if (shouldLabel(placement)) {
        const text = placement.depth === 0 ? data.workspaceName : truncate(placement.node.name, 26);
        const { texture, aspect } = makeLabel(text, color);
        this.labelTextures.push(texture);
        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({
            map: texture,
            transparent: true,
            opacity: placement.depth === 0 ? 0.95 : 0.78,
            depthWrite: false,
            depthTest: false,
          }),
        );
        const height = placement.depth === 0 ? 1.6 : 1.3;
        sprite.scale.set(height * aspect, height, 1);
        sprite.position.set(
          0,
          placement.scale * 1.35 + height * 0.9 + (placement.depth === 0 ? 2.2 : 0.9),
          0,
        );
        sprite.renderOrder = 20;
        group.add(sprite);
      }

      this.content.add(group);

      const spawnAt = 0.15 + placement.depth * 0.16 + (index % 12) * 0.018;
      this.visuals.push({ placement, group, edges, spawnAt, hover: 0 });

      this.addFiles(placement, filePositions, fileColors, fileMeta);

      const parent = parentOf.get(placement.node);
      const parentPlacement = parent ? placementByNode.get(parent) : undefined;
      if (parentPlacement) {
        this.addConnection(parentPlacement, placement, depthLineMaterials);
      }
    });

    if (fileMeta.length > 0) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(filePositions, 3));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(fileColors, 3));
      const material = new THREE.PointsMaterial({
        size: 0.5,
        map: this.glowTexture,
        color: 0xa9cdd9,
        vertexColors: true,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      });
      const points = new THREE.Points(geometry, material);
      points.frustumCulled = false;
      this.filesPoints = points;
      this.fileMeta = fileMeta;
      this.content.add(points);
    } else {
      this.filesPoints = null;
      this.fileMeta = [];
    }

    this.connectionMaterials = [...depthLineMaterials.values()];
    this.createPulses();

    let maxRadius = 0;
    let maxDepth = 0;
    for (const placement of placements) {
      maxRadius = Math.max(maxRadius, placement.radius);
      maxDepth = Math.max(maxDepth, placement.depth);
    }

    this.homeTarget.set(0, -maxDepth * 1.6, 0);
    const distance = THREE.MathUtils.clamp(maxRadius * 1.75 + 32, 38, 138);
    this.homeCam
      .copy(this.homeTarget)
      .add(new THREE.Vector3(0.46, 0.62, 0.74).normalize().multiplyScalar(distance));
  }

  private addCoreRings(group: THREE.Group): void {
    const configs = [
      { radius: 3.5, tube: 0.022, color: 0x5ceaff, rotation: [Math.PI / 2.4, 0, 0] },
      { radius: 4.6, tube: 0.016, color: 0xff64d8, rotation: [0, 0, Math.PI / 2.7] },
      { radius: 5.7, tube: 0.012, color: 0xb8ff5e, rotation: [Math.PI / 3.2, 0.5, 0] },
    ];
    for (const config of configs) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(config.radius, config.tube, 6, 96),
        new THREE.MeshBasicMaterial({
          color: config.color,
          transparent: true,
          opacity: 0.7,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.rotation.set(config.rotation[0]!, config.rotation[1]!, config.rotation[2]!);
      group.add(ring);
      this.rootRings.push(ring);
    }

    const scan = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1.04, 96),
      new THREE.MeshBasicMaterial({
        color: 0x5ceaff,
        transparent: true,
        opacity: 0.5,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    scan.rotation.x = -Math.PI / 2;
    scan.position.y = -0.2;
    group.add(scan);
    this.scanRing = scan;
  }

  private addFiles(
    placement: Placement,
    positions: number[],
    colors: number[],
    meta: FileNode[],
  ): void {
    const files = placement.node.children.filter((child): child is FileNode => child.type === 'file');
    if (files.length === 0) {
      return;
    }

    let start = placement.ownStart;
    let end = placement.ownEnd;
    if (end <= start) {
      start = placement.angle - 0.12;
      end = placement.angle + 0.12;
    }

    const shown = Math.min(files.length, placement.depth <= 1 ? 56 : 34);
    const count = Math.max(shown, 1);
    const baseRadius = placement.depth === 0 ? 3.8 : placement.radius + 1.9;

    for (let i = 0; i < shown; i += 1) {
      const file = files[Math.floor((i * files.length) / count)];
      if (!file) {
        continue;
      }
      const t = count === 1 ? 0.5 : (i + 0.5) / count;
      const angle = THREE.MathUtils.lerp(start, end, t) + (Math.random() - 0.5) * 0.06;
      const radial = baseRadius + Math.random() * (placement.depth === 0 ? 3.4 : 3.0);
      const y = placement.pos.y + (Math.random() - 0.5) * (2.0 + Math.min(placement.scale, 1.6));

      positions.push(Math.cos(angle) * radial, y, Math.sin(angle) * radial);
      const color = new THREE.Color(CATEGORY_HEX[categoryOf(file.ext)]);
      colors.push(color.r, color.g, color.b);
      meta.push(file);
    }
  }

  private addConnection(
    parent: Placement,
    child: Placement,
    materials: Map<number, THREE.LineBasicMaterial>,
  ): void {
    const mid = parent.pos.clone().add(child.pos).multiplyScalar(0.5);
    mid.y += 1.4 + child.depth * 0.35;
    const curve = new THREE.QuadraticBezierCurve3(parent.pos.clone(), mid, child.pos.clone());
    this.curves.push(curve);

    let material = materials.get(child.depth);
    if (!material) {
      material = new THREE.LineBasicMaterial({
        color: PALETTE[child.depth % PALETTE.length]!,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      materials.set(child.depth, material);
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(curve.getPoints(24));
    this.content.add(new THREE.Line(geometry, material));
  }

  private createPulses(): void {
    const curves = this.curves;
    if (curves.length === 0) {
      this.pulses = [];
      this.pulsePoints = null;
      return;
    }

    const positions = new Float32Array(PULSE_COUNT * 3);
    this.pulses = [];
    for (let i = 0; i < PULSE_COUNT; i += 1) {
      this.pulses.push({
        curve: curves[Math.floor(Math.random() * curves.length)]!,
        u: Math.random(),
        speed: 0.1 + Math.random() * 0.2,
      });
    }
    this.pulsePositions = positions;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      size: 0.65,
      map: this.glowTexture,
      color: 0xbdf6ff,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(geometry, material);
    points.frustumCulled = false;
    this.pulsePoints = points;
    this.content.add(points);
  }

  private buildEnvironment(): void {
    const stars = new THREE.Points(
      randomShell(1700, 70, 270),
      new THREE.PointsMaterial({
        size: 0.8,
        map: this.glowTexture,
        color: 0x9fdcf2,
        transparent: true,
        opacity: 0.62,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.world.add(stars);

    const pinkStars = new THREE.Points(
      randomShell(420, 90, 250),
      new THREE.PointsMaterial({
        size: 1.15,
        map: this.glowTexture,
        color: 0xff8ce4,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.world.add(pinkStars);

    const dust = new THREE.Points(
      randomShell(320, 18, 80),
      new THREE.PointsMaterial({
        size: 0.45,
        map: this.glowTexture,
        color: 0x2e7f97,
        transparent: true,
        opacity: 0.45,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.world.add(dust);

    const nebulae: Array<[number, number, number, number, number]> = [
      [-70, 38, -110, 150, 0x1b5266],
      [110, 10, -70, 120, 0x4b2158],
      [10, 70, 120, 170, 0x183f39],
    ];
    for (const [x, y, z, scale, color] of nebulae) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.glowTexture,
          color,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: false,
        }),
      );
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(scale);
      this.world.add(sprite);
    }

    const grid = new THREE.PolarGridHelper(105, 24, 12, 120, 0x0f4152, 0x07222d);
    grid.position.y = -30;
    const gridMaterial = grid.material as THREE.Material;
    gridMaterial.transparent = true;
    gridMaterial.opacity = 0.2;
    gridMaterial.depthWrite = false;
    this.world.add(grid);

    const horizon = new THREE.Mesh(
      new THREE.TorusGeometry(56, 0.03, 4, 180),
      new THREE.MeshBasicMaterial({
        color: 0x1b6c80,
        transparent: true,
        opacity: 0.28,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    horizon.rotation.x = -Math.PI / 2;
    horizon.position.y = -29.8;
    this.world.add(horizon);
  }

  // --------------------------------------------------------------- animation

  private tick = (): void => {
    if (this.disposed) {
      return;
    }
    this.animationId = requestAnimationFrame(this.tick);

    const dt = Math.min(this.clock.getDelta(), 0.05);
    this.elapsed = this.clock.elapsedTime;
    const fade = THREE.MathUtils.clamp((this.elapsed - this.buildTime) / 1.3, 0, 1);

    for (const visual of this.visuals) {
      const age = this.elapsed - this.buildTime - visual.spawnAt;
      const k = THREE.MathUtils.clamp(age / 0.8, 0, 1);
      const hoverTarget = visual.placement === this.hovered ? 1 : 0;
      visual.hover += (hoverTarget - visual.hover) * Math.min(1, dt * 12);
      const spawnScale = k <= 0 ? 0 : easeOutCubic(k);
      visual.group.visible = k > 0;
      visual.group.scale.setScalar(spawnScale * (1 + visual.hover * 0.24));
      const edgeMaterial = visual.edges.material as THREE.LineBasicMaterial;
      edgeMaterial.opacity = 0.55 + visual.hover * 0.45;
    }

    for (const material of this.connectionMaterials) {
      material.opacity = 0.22 * fade;
    }

    if (this.filesPoints) {
      (this.filesPoints.material as THREE.PointsMaterial).opacity = 0.72 * fade;
    }

    if (this.pulsePoints && this.pulsePositions) {
      (this.pulsePoints.material as THREE.PointsMaterial).opacity = 0.9 * fade;
      for (let i = 0; i < this.pulses.length; i += 1) {
        const pulse = this.pulses[i]!;
        pulse.u += pulse.speed * dt;
        if (pulse.u > 1) {
          pulse.u = Math.random() * 0.15;
        }
        const point = pulse.curve.getPoint(pulse.u);
        this.pulsePositions[i * 3] = point.x;
        this.pulsePositions[i * 3 + 1] = point.y;
        this.pulsePositions[i * 3 + 2] = point.z;
      }
      (this.pulsePoints.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    for (let i = 0; i < this.rootRings.length; i += 1) {
      const ring = this.rootRings[i]!;
      ring.rotation.z += dt * (0.16 + i * 0.07);
      ring.rotation.y += dt * (0.1 - i * 0.02);
    }

    if (this.scanRing) {
      const cycle = 3.4;
      const k = (this.elapsed % cycle) / cycle;
      this.scanRing.scale.setScalar(1 + k * 9);
      (this.scanRing.material as THREE.MeshBasicMaterial).opacity = (1 - k) * 0.42 * fade;
    }

    if (this.selectionMesh.visible) {
      this.selectionMesh.rotation.y += dt * 0.7;
      this.selectionMesh.rotation.x = Math.sin(this.elapsed * 0.8) * 0.2;
      const pulse = 1 + Math.sin(this.elapsed * 3.2) * 0.05;
      this.selectionMesh.scale.setScalar(this.selectionBaseScale * pulse);
    }

    if (this.fly) {
      const k = THREE.MathUtils.clamp((this.elapsed - this.fly.start) / this.fly.duration, 0, 1);
      const e = easeInOutCubic(k);
      this.camera.position.lerpVectors(this.fly.fromCam, this.fly.toCam, e);
      this.controls.target.lerpVectors(this.fly.fromTarget, this.fly.toTarget, e);
      if (k >= 1) {
        this.fly = null;
        this.controls.enabled = true;
        this.controls.autoRotate = true;
      }
    }

    this.controls.update();

    this.fpsFrames += 1;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.6) {
      this.callbacks.onFps?.(Math.round(this.fpsFrames / this.fpsTime));
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }

    this.composer.render();
  };

  // --------------------------------------------------------------- interaction

  private updateRaycaster(event: PointerEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    this.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    this.raycaster.params.Points = { threshold: 0.6 };
  }

  private handlePointerMove = (event: PointerEvent): void => {
    this.updateRaycaster(event);

    const dirHits = this.raycaster.intersectObjects(this.crystalMeshes, false);
    if (dirHits.length > 0) {
      const placement = (dirHits[0]!.object as THREE.Mesh).userData.placement as Placement;
      this.hovered = placement;
      this.canvas.style.cursor = 'pointer';
      this.callbacks.onHover({ kind: 'dir', node: placement.node }, event.clientX, event.clientY);
      return;
    }

    if (this.filesPoints) {
      const fileHits = this.raycaster.intersectObject(this.filesPoints, false);
      const index = fileHits[0]?.index;
      if (typeof index === 'number' && this.fileMeta[index]) {
        this.hovered = null;
        this.canvas.style.cursor = 'pointer';
        this.callbacks.onHover({ kind: 'file', node: this.fileMeta[index] }, event.clientX, event.clientY);
        return;
      }
    }

    this.hovered = null;
    this.canvas.style.cursor = 'default';
    this.callbacks.onHover(null, event.clientX, event.clientY);
  };

  private handlePointerDown = (event: PointerEvent): void => {
    this.pointerDown = { x: event.clientX, y: event.clientY };
  };

  private handlePointerUp = (event: PointerEvent): void => {
    const down = this.pointerDown;
    this.pointerDown = null;
    if (!down) {
      return;
    }
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) {
      return;
    }

    this.updateRaycaster(event);

    const dirHits = this.raycaster.intersectObjects(this.crystalMeshes, false);
    if (dirHits.length > 0) {
      const placement = (dirHits[0]!.object as THREE.Mesh).userData.placement as Placement;
      this.select(placement);
      return;
    }

    if (this.filesPoints) {
      const fileHits = this.raycaster.intersectObject(this.filesPoints, false);
      const index = fileHits[0]?.index;
      if (typeof index === 'number' && this.fileMeta[index]) {
        this.callbacks.onOpenFile(this.fileMeta[index]!);
        return;
      }
    }

    this.clearSelection();
  };

  private handlePointerLeave = (): void => {
    this.hovered = null;
    this.canvas.style.cursor = 'default';
    this.callbacks.onHover(null, 0, 0);
  };

  private select(placement: Placement): void {
    this.selectionMesh.visible = true;
    this.selectionMesh.position.copy(placement.pos);
    this.selectionBaseScale = placement.scale * 1.55;
    this.selectionMesh.scale.setScalar(this.selectionBaseScale);
    this.callbacks.onSelectDir(placement.node);

    const focusDist = THREE.MathUtils.clamp(12 + placement.scale * 6, 16, 36);
    const direction = this.camera.position.clone().sub(this.controls.target).normalize();
    const camPos = placement.pos.clone().add(direction.multiplyScalar(focusDist));
    this.animateCamera(placement.pos.clone(), camPos, 1.05);
  }

  private animateCamera(target: THREE.Vector3, camPos: THREE.Vector3, duration: number): void {
    this.fly = {
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      fromCam: this.camera.position.clone(),
      toCam: camPos.clone(),
      start: this.elapsed,
      duration,
    };
    this.controls.enabled = false;
    this.controls.autoRotate = false;
  }

  private resize(): void {
    const width = Math.max(this.canvas.clientWidth, 1);
    const height = Math.max(this.canvas.clientHeight, 1);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
    this.composer.setSize(width, height);
    this.bloom.setSize(width, height);
  }

  private clearContent(): void {
    disposeObject(this.content);
    this.content.clear();
    for (const texture of this.labelTextures) {
      texture.dispose();
    }
    this.labelTextures = [];
    this.visuals = [];
    this.crystalMeshes = [];
    this.fileMeta = [];
    this.filesPoints = null;
    this.connectionMaterials = [];
    this.curves = [];
    this.pulses = [];
    this.pulsePoints = null;
    this.pulsePositions = null;
    this.rootRings = [];
    this.scanRing = null;
    this.hovered = null;
    this.selectionMesh.visible = false;
    this.controls.autoRotate = true;
    this.controls.enabled = true;
    this.fly = null;
  }
}

// ------------------------------------------------------------------ helpers

function selectDirs(root: DirNode): Set<DirNode> {
  const selected = new Set<DirNode>([root]);
  let frontier: DirNode[] = [root];
  const caps = [20, 44, 44, 30];

  for (let level = 0; level < caps.length; level += 1) {
    const candidates: DirNode[] = [];
    for (const parent of frontier) {
      for (const child of parent.children) {
        if (child.type === 'dir') {
          candidates.push(child);
        }
      }
    }
    candidates.sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));
    const take = candidates.slice(0, caps[level]!);
    for (const dir of take) {
      selected.add(dir);
    }
    frontier = take;
    if (take.length === 0) {
      break;
    }
  }

  return selected;
}

function layoutTree(
  root: DirNode,
  selected: Set<DirNode>,
  parentOf: Map<DirNode, DirNode>,
): Placement[] {
  const placements: Placement[] = [];

  const visit = (node: DirNode, start: number, end: number, depth: number): void => {
    const angle = (start + end) / 2;
    const radius = depth === 0 ? 0 : 10 + depth * 9.5;
    const y = depth === 0 ? 0 : -depth * 5;
    const scale =
      depth === 0
        ? 2.55
        : THREE.MathUtils.clamp(0.5 + Math.log2(node.fileCount + 1) * 0.3, 0.58, 1.95);

    const placement: Placement = {
      node,
      depth,
      pos: new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius),
      radius,
      scale,
      color: PALETTE[depth % PALETTE.length]!,
      angle,
      start,
      end,
      ownStart: 0,
      ownEnd: 0,
    };
    placements.push(placement);

    const kids = node.children
      .filter((child): child is DirNode => child.type === 'dir' && selected.has(child))
      .sort((a, b) => b.fileCount - a.fileCount || a.name.localeCompare(b.name));

    for (const kid of kids) {
      parentOf.set(kid, node);
    }

    const weights = kids.map((kid) => Math.max(1.4, Math.pow(kid.fileCount, 0.65)));
    const ownWeight =
      node.ownFileCount > 0 ? Math.max(1.4, Math.min(90, node.ownFileCount) * 0.4) : 0;
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) + ownWeight;
    const pad = Math.min((end - start) * 0.07, 0.05 + depth * 0.008);
    const usable = Math.max(end - start - pad, 0.001);
    let cursor = start + pad / 2;

    kids.forEach((kid, index) => {
      const share = usable * (weights[index]! / Math.max(totalWeight, 0.001));
      visit(kid, cursor, cursor + share, depth + 1);
      cursor += share;
    });

    if (ownWeight > 0) {
      placement.ownStart = cursor;
      placement.ownEnd = cursor + usable * (ownWeight / Math.max(totalWeight, 0.001));
    }
  };

  visit(root, 0, Math.PI * 2, 0);
  return placements;
}

function shouldLabel(placement: Placement): boolean {
  if (placement.depth === 0) {
    return true;
  }
  if (placement.depth === 1) {
    return placement.node.fileCount > 0;
  }
  return false;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function createGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.14)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function makeLabel(text: string, color: THREE.Color): { texture: THREE.Texture; aspect: number } {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d')!;
  const font = '600 40px "SFMono-Regular", ui-monospace, Menlo, monospace';
  context.font = font;
  const width = Math.ceil(context.measureText(text).width) + 44;
  const height = 72;
  canvas.width = Math.max(width, 64);
  canvas.height = height;

  const tint = color.clone().lerp(new THREE.Color(0xffffff), 0.55);
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.shadowColor = color.getStyle();
  context.shadowBlur = 10;
  context.fillStyle = tint.getStyle();
  context.fillText(text, canvas.width / 2, height / 2 - 4);
  context.shadowBlur = 0;

  context.strokeStyle = color.getStyle();
  context.globalAlpha = 0.55;
  context.lineWidth = 1.5;
  const lineWidth = Math.min(canvas.width * 0.32, 90);
  context.beginPath();
  context.moveTo((canvas.width - lineWidth) / 2, height - 12);
  context.lineTo((canvas.width + lineWidth) / 2, height - 12);
  context.stroke();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return { texture, aspect: canvas.width / height };
}

function randomShell(count: number, min: number, max: number): THREE.BufferGeometry {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const radius = min + Math.random() * (max - min);
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = radius * Math.cos(phi) * 0.7;
    positions[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

function createSelectionMesh(): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1, 0));
  const material = new THREE.LineBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.LineSegments(geometry, material);
  mesh.visible = false;
  return mesh;
}

function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    const withGeometry = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
    };
    withGeometry.geometry?.dispose();
    const material = withGeometry.material;
    if (Array.isArray(material)) {
      for (const entry of material) {
        entry.dispose();
      }
    } else {
      material?.dispose();
    }
  });
}
