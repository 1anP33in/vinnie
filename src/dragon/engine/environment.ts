// The space around the dragon: cool lighting, fog, drifting snow, the
// occasional ice glint, and a dark floor that fades into the background.
// Everything here is cosmetic and can be switched off.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  FogExp2,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  ShadowMaterial,
  SRGBColorSpace,
  Vector3,
  type Scene,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from "three";
import { Reflector } from "three/examples/jsm/objects/Reflector.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { QualityPreset } from "./quality";

export const BACKGROUND = new Color(0x060a11);
const GLOW_OFFSET = new Vector3(0, 0.25, 0.35);

export interface EnvironmentToggles {
  snow: boolean;
  iceParticles: boolean;
  fog: boolean;
}

function radialTexture(inner: string, outer: string, size = 128): CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, inner);
    g.addColorStop(1, outer);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class DragonEnvironment {
  readonly group = new Group();
  readonly key: DirectionalLight;
  readonly headGlow: PointLight;
  private readonly disposables: { dispose(): void }[] = [];
  private envTarget: WebGLRenderTarget | null = null;
  private snow: Points | null = null;
  private snowSpeed: Float32Array | null = null;
  private ice: Points | null = null;
  private icePhase: Float32Array | null = null;
  private time = 0;
  private readonly fog = new FogExp2(BACKGROUND.getHex(), 0.045);

  constructor(
    private readonly scene: Scene,
    renderer: WebGLRenderer,
    private readonly preset: QualityPreset,
    private readonly lighting: boolean,
    toggles: EnvironmentToggles,
    /** Rough radius of the dragon, for placing particles and lights. */
    private readonly radius: number,
  ) {
    scene.add(this.group);

    // Image-based light for the clear-coat scales and ice.
    const pmrem = new PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    this.envTarget = pmrem.fromScene(room, 0.04);
    room.dispose();
    pmrem.dispose();
    scene.environment = this.envTarget.texture;
    scene.environmentIntensity = lighting ? 0.45 : 0.3;

    const hemi = new HemisphereLight(0xa9dcff, 0x0a1220, lighting ? 0.9 : 1.2);
    this.group.add(hemi);

    this.key = new DirectionalLight(0xe8f6ff, lighting ? 2.3 : 2);
    this.key.position.set(4, 8, 6);
    if (lighting && preset.shadowMapSize > 0) {
      this.key.castShadow = true;
      this.key.shadow.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
      const s = radius * 1.3;
      Object.assign(this.key.shadow.camera, { left: -s, right: s, top: s, bottom: -s, near: 0.5, far: 30 });
      this.key.shadow.bias = -0.0005;
      this.key.shadow.normalBias = 0.02;
    }
    this.group.add(this.key);

    this.headGlow = new PointLight(0x6fe3ff, 0, 5, 1.6);
    if (lighting) {
      const rim = new DirectionalLight(0x5fd4ff, 1.7);
      rim.position.set(-5, 3.5, -6);
      const rim2 = new DirectionalLight(0x3a8cff, 0.8);
      rim2.position.set(6, 2, -4);
      this.group.add(rim, rim2, this.headGlow);
    }

    this.buildFloor(renderer);
    this.buildSnow();
    this.buildIce();
    this.setToggles(toggles);
  }

  private buildFloor(renderer: WebGLRenderer): void {
    const size = this.radius * 4;
    const fade = radialTexture("#ffffff", "#000000");
    this.disposables.push(fade);
    if (this.lighting && this.preset.reflections) {
      const pixelRatio = renderer.getPixelRatio();
      const canvas = renderer.domElement;
      const mirror = new Reflector(new CircleGeometry(size, 48), {
        textureWidth: Math.max(256, Math.floor(canvas.width * 0.5 * pixelRatio)),
        textureHeight: Math.max(256, Math.floor(canvas.height * 0.5 * pixelRatio)),
        color: new Color(0x3a4a5c),
        clipBias: 0.003,
      });
      mirror.rotation.x = -Math.PI / 2;
      mirror.position.y = -0.002;
      this.group.add(mirror);
      this.disposables.push({ dispose: () => mirror.dispose() });
    }
    // Dark, slightly glossy floor that fades out at the edges. Over a mirror it
    // is translucent, so the reflection stays subtle.
    const floorMaterial = new MeshStandardMaterial({
      color: 0x0d1724,
      roughness: 0.55,
      metalness: 0.25,
      transparent: true,
      opacity: this.lighting && this.preset.reflections ? 0.82 : 1,
      alphaMap: fade,
      depthWrite: false,
    });
    const floor = new Mesh(new CircleGeometry(size, 48), floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    floor.renderOrder = -1;
    this.group.add(floor);
    this.disposables.push(floor.geometry, floorMaterial);

    if (this.key.castShadow) {
      const shadowMaterial = new ShadowMaterial({ opacity: 0.5, color: 0x01040a });
      const catcher = new Mesh(new CircleGeometry(size * 0.6, 48), shadowMaterial);
      catcher.rotation.x = -Math.PI / 2;
      catcher.position.y = 0.002;
      catcher.receiveShadow = true;
      this.group.add(catcher);
      this.disposables.push(catcher.geometry, shadowMaterial);
    }
  }

  private buildSnow(): void {
    const count = this.preset.snowCount;
    const positions = new Float32Array(count * 3);
    this.snowSpeed = new Float32Array(count);
    const r = this.radius * 2.2;
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() * 2 - 1) * r;
      positions[i * 3 + 1] = Math.random() * r * 1.4;
      positions[i * 3 + 2] = (Math.random() * 2 - 1) * r;
      this.snowSpeed[i] = 0.25 + Math.random() * 0.45;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    const sprite = radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)", 64);
    const material = new PointsMaterial({
      size: 0.07,
      map: sprite,
      color: 0xdff4ff,
      transparent: true,
      opacity: 0.8,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.snow = new Points(geometry, material);
    this.snow.frustumCulled = false;
    this.group.add(this.snow);
    this.disposables.push(geometry, material, sprite);
  }

  private buildIce(): void {
    const count = this.preset.iceCount;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    this.icePhase = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      this.placeIce(positions, i);
      this.icePhase[i] = Math.random() * Math.PI * 2;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(positions, 3));
    geometry.setAttribute("color", new BufferAttribute(colors, 3));
    const sprite = radialTexture("rgba(255,255,255,1)", "rgba(255,255,255,0)", 64);
    const material = new PointsMaterial({
      size: 0.16,
      map: sprite,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.ice = new Points(geometry, material);
    this.ice.frustumCulled = false;
    this.group.add(this.ice);
    this.disposables.push(geometry, material, sprite);
  }

  private placeIce(positions: Float32Array, i: number): void {
    const angle = Math.random() * Math.PI * 2;
    const dist = this.radius * (0.35 + Math.random() * 0.7);
    positions[i * 3] = Math.cos(angle) * dist;
    positions[i * 3 + 1] = 0.3 + Math.random() * this.radius * 0.8;
    positions[i * 3 + 2] = Math.sin(angle) * dist;
  }

  setToggles(t: EnvironmentToggles): void {
    if (this.snow) this.snow.visible = t.snow;
    if (this.ice) this.ice.visible = t.iceParticles;
    this.scene.fog = t.fog ? this.fog : null;
  }

  /** Move the glow light to the dragon's head. */
  setHeadPosition(p: Vector3): void {
    this.headGlow.position.copy(p).add(GLOW_OFFSET);
  }

  update(dt: number, glow: number): void {
    this.time += dt;
    this.headGlow.intensity = this.lighting ? 0.2 + glow * 2.4 : 0;

    if (this.snow?.visible && this.snowSpeed) {
      const attr = this.snow.geometry.getAttribute("position") as BufferAttribute;
      const a = attr.array as Float32Array;
      const top = this.radius * 2.2 * 1.4;
      for (let i = 0; i < this.snowSpeed.length; i++) {
        const y = (a[i * 3 + 1] ?? 0) - (this.snowSpeed[i] ?? 0) * dt;
        a[i * 3 + 1] = y < 0 ? top : y;
        a[i * 3] = (a[i * 3] ?? 0) + Math.sin(this.time * 0.6 + i) * 0.08 * dt;
      }
      attr.needsUpdate = true;
    }

    if (this.ice?.visible && this.icePhase) {
      const pos = this.ice.geometry.getAttribute("position") as BufferAttribute;
      const col = this.ice.geometry.getAttribute("color") as BufferAttribute;
      const p = pos.array as Float32Array;
      const c = col.array as Float32Array;
      for (let i = 0; i < this.icePhase.length; i++) {
        const phase = this.icePhase[i] ?? 0;
        const next = phase + dt * (0.5 + (i % 5) * 0.12);
        this.icePhase[i] = next;
        const before = Math.sin(phase);
        const s = Math.sin(next);
        // Only the top of each sine shows: brief glints with long gaps.
        const glint = Math.pow(Math.max(0, s), 12);
        c[i * 3] = 0.55 * glint;
        c[i * 3 + 1] = 0.9 * glint;
        c[i * 3 + 2] = 1 * glint;
        if (before < 0 && s >= 0) this.placeIce(p, i);
      }
      pos.needsUpdate = true;
      col.needsUpdate = true;
    }
  }

  dispose(): void {
    this.scene.remove(this.group);
    this.scene.environment = null;
    this.scene.fog = null;
    this.envTarget?.dispose();
    this.envTarget = null;
    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.key.dispose();
    this.headGlow.dispose();
  }
}

