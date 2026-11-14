// DragonController: owns the WebGL renderer, scene, camera, and render loop
// for one viewer. It renders only; it never touches the agent. All failures
// are reported through onStatus and never thrown into the app.

import {
  ACESFilmicToneMapping,
  Box3,
  Clock,
  MathUtils,
  PCFSoftShadowMap,
  PerspectiveCamera,
  Scene,
  Spherical,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Bone,
  type Material,
  type Mesh,
  type MeshPhysicalMaterial,
  type Object3D,
  type Texture,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DragonCamera, DragonQuality } from "@/lib/ipc/types";
import type { DragonBehavior } from "../behavior";
import { DragonAnimationManager, type Reaction } from "./animation";
import { DragonEnvironment, type EnvironmentToggles } from "./environment";
import { DragonLoadError, HEAD, inspectDragon, loadDragonModel, reportWarnings, type ModelReport } from "./model";
import { IDLE_FPS_FACTOR, QUALITY_PRESETS, type QualityPreset } from "./quality";

export interface ViewerConfig extends EnvironmentToggles {
  quality: DragonQuality;
  lightingEffects: boolean;
  /** Percent, 25–200. */
  animationSpeed: number;
  idleAnimations: boolean;
  followCursor: boolean;
  camera: DragonCamera;
}

export type ViewerStatus =
  | { phase: "loading" }
  | { phase: "ready"; report: ModelReport; warnings: string[] }
  | { phase: "error"; message: string; detail?: string }
  | { phase: "context-lost" }
  /** The context came back; GPU-generated textures are gone, so rebuild. */
  | { phase: "restored" };

export interface ControllerCallbacks {
  onStatus(status: ViewerStatus): void;
  /** The user moved the camera (after the drag ends). */
  onCameraChange(camera: DragonCamera): void;
}

const FOV = 30;

type EmissiveMaterial = Material & { emissiveIntensity?: number; userData: { baseEmissive?: number } };

export class DragonController {
  private renderer: WebGLRenderer | null = null;
  private scene = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  private controls: OrbitControls | null = null;
  private environment: DragonEnvironment | null = null;
  private animation: DragonAnimationManager | null = null;
  private model: Object3D | null = null;
  private head: Bone | null = null;
  private emissive: EmissiveMaterial[] = [];
  private target = new Vector3(0, 1.3, -0.5);
  private baseDistance = 12;
  private radius = 4;
  private preset: QualityPreset;
  private clock = new Clock(false);
  private frame = 0;
  private lastRender = 0;
  private visible = true;
  private disposed = false;
  private resizeObserver: ResizeObserver | null = null;
  private behavior: DragonBehavior = "idle";
  private contextTimer: ReturnType<typeof setTimeout> | null = null;
  private pointerNdc: { x: number; y: number } | null = null;
  private readonly scratch = new Vector3();
  private readonly scratch2 = new Vector3();

  constructor(
    private readonly container: HTMLElement,
    private config: ViewerConfig,
    private readonly callbacks: ControllerCallbacks,
  ) {
    this.preset = QUALITY_PRESETS[config.quality];
  }

  /** Create the renderer and load the dragon. Resolves even on failure. */
  async start(): Promise<void> {
    this.callbacks.onStatus({ phase: "loading" });
    try {
      this.renderer = new WebGLRenderer({
        antialias: this.preset.antialias,
        alpha: true,
        powerPreference: "default",
        failIfMajorPerformanceCaveat: false,
      });
    } catch (err) {
      this.callbacks.onStatus({
        phase: "error",
        message: "3D rendering couldn't start on this computer (WebGL is unavailable).",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const r = this.renderer;
    r.setClearColor(0x000000, 0);
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = this.config.lightingEffects && this.preset.shadowMapSize > 0;
    r.shadowMap.type = PCFSoftShadowMap;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio));
    r.domElement.className = "block h-full w-full outline-none";
    r.domElement.setAttribute("aria-hidden", "true");
    r.domElement.addEventListener("webglcontextlost", this.onContextLost);
    r.domElement.addEventListener("webglcontextrestored", this.onContextRestored);
    this.container.appendChild(r.domElement);
    this.resize();

    let gltf;
    try {
      gltf = await loadDragonModel();
    } catch (err) {
      if (this.disposed) return;
      this.callbacks.onStatus({
        phase: "error",
        message: err instanceof DragonLoadError ? err.message : "The dragon model couldn't be loaded.",
        detail: err instanceof Error && !(err instanceof DragonLoadError) ? err.message : undefined,
      });
      return;
    }
    if (this.disposed) return;

    try {
      this.setupModel(gltf.scene, gltf.animations);
    } catch (err) {
      this.callbacks.onStatus({
        phase: "error",
        message: "The dragon model loaded but couldn't be set up for display.",
        detail: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    const report = inspectDragon(gltf.scene, gltf.animations);
    this.callbacks.onStatus({ phase: "ready", report, warnings: reportWarnings(report) });

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.container);
    window.addEventListener("pointermove", this.onPointerMove, { passive: true });
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.clock.start();
    this.loop();
  }

  private setupModel(root: Object3D, clips: import("three").AnimationClip[]): void {
    const r = this.renderer!;
    this.model = root;
    this.scene.add(root);
    root.position.set(0, 0, 0);
    root.updateMatrixWorld(true);

    // Frame the body (wings excluded: they fold most of the time).
    const body = root.getObjectByName("Dragon_Body") ?? root;
    const box = new Box3().setFromObject(body);
    const size = box.getSize(new Vector3());
    box.getCenter(this.target);
    this.target.y = Math.max(this.target.y, size.y * 0.45);
    this.radius = Math.max(size.x, size.y, size.z) * 0.55;
    this.baseDistance = this.radius / Math.sin(MathUtils.degToRad(FOV / 2)) * 0.95;

    const shadows = r.shadowMap.enabled;
    const emissive = new Set<EmissiveMaterial>();
    root.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = shadows;
      mesh.receiveShadow = false;
      // Skinned bounds follow the bind pose; animated poses could be culled.
      mesh.frustumCulled = false;
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        this.applyQualityToMaterial(m as MeshPhysicalMaterial);
        const em = m as EmissiveMaterial;
        if (typeof em.emissiveIntensity === "number") {
          em.userData.baseEmissive ??= em.emissiveIntensity;
          emissive.add(em);
        }
      }
    });
    this.emissive = [...emissive];
    this.head = (root.getObjectByName(HEAD) as Bone | undefined) ?? null;

    this.environment = new DragonEnvironment(this.scene, r, this.preset, this.config.lightingEffects, this.config, this.radius * 1.6);

    this.animation = new DragonAnimationManager(root, clips);
    this.applyAnimationConfig();
    this.animation.setBehavior(this.behavior);

    this.camera.near = 0.1;
    this.camera.far = this.baseDistance * 6;
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = false;
    this.controls.minDistance = this.baseDistance * 0.5;
    this.controls.maxDistance = this.baseDistance * 2.5;
    this.controls.minPolarAngle = MathUtils.degToRad(30);
    this.controls.maxPolarAngle = MathUtils.degToRad(95);
    this.controls.target.copy(this.target);
    this.controls.addEventListener("end", this.onCameraEnd);
    this.applyCamera(this.config.camera);
  }

  /** Transmission (glass-like ice) costs an extra pass; lower presets fake it. */
  private applyQualityToMaterial(m: MeshPhysicalMaterial): void {
    if (!m || typeof m.transmission !== "number") return;
    m.userData.orig ??= { transmission: m.transmission, transparent: m.transparent, opacity: m.opacity };
    const orig = m.userData.orig as { transmission: number; transparent: boolean; opacity: number };
    if (orig.transmission > 0 && !this.preset.transmission) {
      m.transmission = 0;
      m.transparent = true;
      m.opacity = 0.82;
    } else {
      m.transmission = orig.transmission;
      m.transparent = orig.transparent;
      m.opacity = orig.opacity;
    }
    m.needsUpdate = true;
  }

  private applyAnimationConfig(): void {
    if (!this.animation) return;
    this.animation.setOptions({ idleAnimations: this.config.idleAnimations, speed: this.config.animationSpeed / 100 });
    this.animation.followCursor = this.config.followCursor;
  }

  private applyCamera(cam: DragonCamera): void {
    const spherical = new Spherical(
      this.baseDistance * (cam.distancePct / 100),
      MathUtils.degToRad(90 - cam.elevationDeg),
      MathUtils.degToRad(cam.azimuthDeg),
    );
    this.camera.position.setFromSpherical(spherical).add(this.target);
    this.camera.lookAt(this.target);
    this.controls?.update();
  }

  private currentCamera(): DragonCamera {
    const offset = this.scratch.copy(this.camera.position).sub(this.target);
    const s = new Spherical().setFromVector3(offset);
    return {
      azimuthDeg: Math.round(MathUtils.radToDeg(s.theta)),
      elevationDeg: Math.round(90 - MathUtils.radToDeg(s.phi)),
      distancePct: Math.round((s.radius / this.baseDistance) * 100),
    };
  }

  private onCameraEnd = () => {
    this.callbacks.onCameraChange(this.currentCamera());
  };

  /** Options that can change without rebuilding the renderer. */
  setConfig(config: ViewerConfig): void {
    const cameraChanged = JSON.stringify(config.camera) !== JSON.stringify(this.config.camera);
    this.config = config;
    this.environment?.setToggles(config);
    this.applyAnimationConfig();
    // Only follow external camera changes (e.g. Reset), not our own saves.
    if (cameraChanged && JSON.stringify(config.camera) !== JSON.stringify(this.currentCamera())) {
      this.applyCamera(config.camera);
    }
  }

  setBehavior(behavior: DragonBehavior): void {
    this.behavior = behavior;
    this.animation?.setBehavior(behavior);
  }

  react(kind: Reaction): void {
    this.animation?.react(kind);
  }

  resetCamera(camera: DragonCamera): void {
    this.applyCamera(camera);
  }

  /** Pause rendering while the viewer is hidden or scrolled away. */
  setVisible(visible: boolean): void {
    if (this.visible === visible) return;
    this.visible = visible;
    if (visible) this.loop();
  }

  private onVisibilityChange = () => {
    if (document.visibilityState === "visible") this.loop();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.renderer) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    // Pointer anywhere in the window, in the viewer's normalized coordinates.
    this.pointerNdc = {
      x: MathUtils.clamp(((e.clientX - rect.left) / rect.width) * 2 - 1, -3, 3),
      y: MathUtils.clamp(-(((e.clientY - rect.top) / rect.height) * 2 - 1), -3, 3),
    };
  };

  private onContextLost = (e: Event) => {
    e.preventDefault();
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.callbacks.onStatus({ phase: "context-lost" });
    this.contextTimer = setTimeout(() => {
      this.callbacks.onStatus({ phase: "error", message: "The graphics context was lost and didn't come back." });
    }, 8_000);
  };

  private onContextRestored = () => {
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.contextTimer = null;
    this.callbacks.onStatus({ phase: "restored" });
  };

  private resize(): void {
    if (!this.renderer) return;
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Narrow panels: widen the vertical field so the dragon still fits.
    this.camera.fov = w / h < 1 ? Math.min(55, FOV / Math.max(0.55, w / h)) : FOV;
    this.camera.updateProjectionMatrix();
  }

  private loop = () => {
    if (this.disposed || !this.visible || document.visibilityState === "hidden" || this.frame) return;
    const tick = (now: number) => {
      this.frame = 0;
      if (this.disposed || !this.visible || document.visibilityState === "hidden") return;
      this.frame = requestAnimationFrame(tick);
      const resting = this.behavior === "idle" || this.behavior === "cancelled";
      const fps = this.preset.fps * (resting ? IDLE_FPS_FACTOR : 1);
      if (now - this.lastRender < 1000 / fps - 2) return;
      this.lastRender = now;
      try {
        this.renderFrame();
      } catch (err) {
        cancelAnimationFrame(this.frame);
        this.frame = 0;
        this.callbacks.onStatus({
          phase: "error",
          message: "Rendering the dragon failed.",
          detail: err instanceof Error ? err.message : String(err),
        });
      }
    };
    this.frame = requestAnimationFrame(tick);
  };

  private renderFrame(): void {
    const r = this.renderer;
    if (!r || !this.animation) return;
    const dt = this.clock.getDelta();
    this.controls?.update();
    if (this.head) {
      const headPos = this.head.getWorldPosition(this.scratch);
      this.environment?.setHeadPosition(headPos);
      const toCam = this.scratch2.copy(this.camera.position).sub(headPos);
      this.animation.setUserDirection(Math.atan2(toCam.x, toCam.z), Math.atan2(toCam.y, Math.hypot(toCam.x, toCam.z)));
      if (this.pointerNdc) {
        // Point under the cursor at the head's depth, then aim at it.
        const dist = this.camera.position.distanceTo(headPos);
        const dir = this.scratch2.set(this.pointerNdc.x, this.pointerNdc.y, 0.5).unproject(this.camera).sub(this.camera.position).normalize();
        const point = dir.multiplyScalar(dist).add(this.camera.position).sub(headPos);
        this.animation.setPointer(Math.atan2(point.x, point.z), Math.atan2(point.y, Math.hypot(point.x, point.z)));
        this.pointerNdc = null;
      }
    }
    const pose = this.animation.update(dt);
    const glow = this.config.lightingEffects ? pose.glow : 0.2;
    for (const m of this.emissive) {
      m.emissiveIntensity = (m.userData.baseEmissive ?? 1) * (0.75 + glow * 0.9);
    }
    this.environment?.update(dt * (this.config.animationSpeed / 100), glow);
    r.render(this.scene, this.camera);
  }

  /** Free GPU resources. The parsed model stays cached for the next viewer. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.contextTimer) clearTimeout(this.contextTimer);
    this.resizeObserver?.disconnect();
    window.removeEventListener("pointermove", this.onPointerMove);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.controls?.removeEventListener("end", this.onCameraEnd);
    this.controls?.dispose();
    this.animation?.dispose();
    this.environment?.dispose();
    if (this.model) {
      this.model.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          for (const value of Object.values(m)) if ((value as Texture)?.isTexture) (value as Texture).dispose();
          m.dispose();
        }
      });
      this.scene.remove(this.model);
      this.model = null;
    }
    const r = this.renderer;
    this.renderer = null;
    if (r) {
      r.domElement.removeEventListener("webglcontextlost", this.onContextLost);
      r.domElement.removeEventListener("webglcontextrestored", this.onContextRestored);
      r.dispose();
      r.forceContextLoss();
      r.domElement.remove();
    }
  }
}
