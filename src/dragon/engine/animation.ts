// DragonAnimationManager: plays the model's own clips (breathing, blinking,
// wing fold) and layers small procedural rotations on the existing rig for
// head, neck, tail, wings, and jaw. Clips are split per body part so they
// can run together: each clip in the GLB keys every bone.

import {
  AnimationClip,
  AnimationMixer,
  LoopOnce,
  LoopRepeat,
  Quaternion,
  Vector3,
  type AnimationAction,
  type Bone,
  type Object3D,
} from "three";
import type { DragonBehavior } from "../behavior";
import { CLIP, EYELID_BONES, HEAD, JAW, NECK_BONES, TAIL_BONES, WING_UPPER } from "./model";
import { easePose, MAX_WING_FOLD, POSES, withIdlePaused, type PoseTarget } from "./poses";

/** Model-space axes (glTF: +Y up, the dragon faces +Z, its left is +X). */
const AXIS_YAW = new Vector3(0, 1, 0);
const AXIS_RAISE_HEAD = new Vector3(-1, 0, 0);
const AXIS_RAISE_TAIL = new Vector3(1, 0, 0);
const AXIS_OPEN_JAW = new Vector3(1, 0, 0);
const AXIS_ROLL = new Vector3(0, 0, 1);

const NECK_YAW_SHARE = [0.12, 0.18, 0.22, 0.23];
const HEAD_YAW_SHARE = 0.25;
const NECK_RAISE_SHARE = [0.35, 0.3, 0.2, 0.15];

const MAX_YAW = 0.6;
const MAX_PITCH = 0.35;

export type Reaction = "task_started" | "tool_started" | "celebrate" | "flinch";

interface Driven {
  bone: Bone;
  rest: Quaternion;
  /** Model-space axes expressed in the bone's local frame at rest. */
  axes: Map<Vector3, Vector3>;
}

export interface AnimationOptions {
  idleAnimations: boolean;
  /** 0.25–2. */
  speed: number;
}

/** Deterministic PRNG so idle glances are varied but reproducible in tests. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function filterClip(clip: AnimationClip, keep: (bone: string) => boolean, name: string): AnimationClip {
  const tracks = clip.tracks.filter((t) => keep(t.name.slice(0, t.name.lastIndexOf("."))));
  return new AnimationClip(name, clip.duration, tracks);
}

const isWingBone = (b: string) => b.startsWith("wing_");
const isEyelid = (b: string) => EYELID_BONES.includes(b);

export class DragonAnimationManager {
  readonly mixer: AnimationMixer;
  private idle: AnimationAction | null = null;
  private blink: AnimationAction | null = null;
  private fold: AnimationAction | null = null;
  private foldDuration = 1;
  private driven = new Map<string, Driven>();
  private behavior: DragonBehavior = "idle";
  private pose: PoseTarget = { ...POSES.idle };
  private options: AnimationOptions = { idleAnimations: true, speed: 1 };
  private time = 0;
  private random: () => number;
  private nextBlink = 2;
  private nextGlance = 1.5;
  private glance = { yaw: 0, pitch: 0 };
  private look = { yaw: 0, pitch: 0 };
  private pointer: { x: number; y: number; at: number } | null = null;
  private userDirection: { yaw: number; pitch: number } = { yaw: 0, pitch: 0 };
  private reactions: { kind: Reaction; at: number }[] = [];
  private readonly scratch = new Quaternion();
  followCursor = true;

  constructor(
    private readonly root: Object3D,
    clips: AnimationClip[],
    seed = 7,
  ) {
    this.random = mulberry32(seed);
    this.mixer = new AnimationMixer(root);
    const byName = new Map(clips.map((c) => [c.name, c]));

    const idleClip = byName.get(CLIP.idle);
    if (idleClip) {
      // Wings and eyelids get their own clips; the jaw is procedural.
      const clip = filterClip(idleClip, (b) => !isWingBone(b) && !isEyelid(b) && b !== JAW, "idle_body");
      this.idle = this.mixer.clipAction(clip).setLoop(LoopRepeat, Infinity);
      this.idle.play();
    }
    const blinkClip = byName.get(CLIP.blink);
    if (blinkClip) {
      this.blink = this.mixer.clipAction(filterClip(blinkClip, isEyelid, "blink_lids")).setLoop(LoopOnce, 1);
      this.blink.clampWhenFinished = false;
    }
    const foldClip = byName.get(CLIP.wingsFold);
    if (foldClip) {
      this.foldDuration = foldClip.duration;
      this.fold = this.mixer.clipAction(filterClip(foldClip, isWingBone, "wings_fold"));
      this.fold.play();
      this.fold.paused = true;
      this.fold.time = this.pose.wingFold * this.foldDuration;
    }

    root.updateMatrixWorld(true);
    const rootInverse = new Quaternion();
    root.getWorldQuaternion(rootInverse).invert();
    const names = [HEAD, JAW, ...NECK_BONES, ...TAIL_BONES, WING_UPPER.L, WING_UPPER.R];
    const axes = [AXIS_YAW, AXIS_RAISE_HEAD, AXIS_RAISE_TAIL, AXIS_OPEN_JAW, AXIS_ROLL];
    for (const name of names) {
      const bone = root.getObjectByName(name) as Bone | undefined;
      if (!bone) continue;
      const modelQ = rootInverse.clone().multiply(bone.getWorldQuaternion(new Quaternion()));
      const toLocal = modelQ.clone().invert();
      const local = new Map<Vector3, Vector3>();
      for (const axis of axes) local.set(axis, axis.clone().applyQuaternion(toLocal).normalize());
      this.driven.set(name, { bone, rest: bone.quaternion.clone(), axes: local });
    }
  }

  get currentBehavior(): DragonBehavior {
    return this.behavior;
  }

  get currentPose(): Readonly<PoseTarget> {
    return this.pose;
  }

  get hasClips(): { idle: boolean; blink: boolean; fold: boolean } {
    return { idle: !!this.idle, blink: !!this.blink, fold: !!this.fold };
  }

  setBehavior(behavior: DragonBehavior): void {
    this.behavior = behavior;
  }

  setOptions(options: AnimationOptions): void {
    this.options = { ...options, speed: Math.min(2, Math.max(0.25, options.speed)) };
  }

  react(kind: Reaction): void {
    this.reactions.push({ kind, at: this.time });
  }

  /** Direction from the head toward the cursor (model-space yaw/pitch). */
  setPointer(yaw: number, pitch: number): void {
    this.pointer = { x: yaw, y: pitch, at: this.time };
  }

  /** Direction from the dragon's head to the camera, in model space angles. */
  setUserDirection(yaw: number, pitch: number): void {
    this.userDirection = { yaw, pitch };
  }

  /** Advance by real seconds. Returns the eased pose (for glow/lighting). */
  update(realDt: number): PoseTarget {
    const dt = Math.min(realDt, 0.1) * this.options.speed;
    this.time += dt;
    const resting = this.behavior === "idle" || this.behavior === "cancelled";
    const idlePaused = !this.options.idleAnimations;

    let target = POSES[this.behavior];
    if (idlePaused && resting) target = withIdlePaused(target);
    this.pose = easePose(this.pose, target, dt);

    // Base layer: the model's own clips.
    if (this.idle) {
      this.idle.paused = idlePaused && resting;
      this.idle.timeScale = this.pose.breath;
    }
    if (this.fold) this.fold.time = Math.min(MAX_WING_FOLD, Math.max(0, this.pose.wingFold)) * this.foldDuration * 0.999;
    if (this.blink && !(idlePaused && resting)) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) {
        this.blink.reset().play();
        // Slower blinking when focused on work.
        const focused = this.behavior === "executing" || this.behavior === "verifying";
        this.nextBlink = (focused ? 4 : 2.5) + this.random() * 4;
      }
    }
    for (const d of this.driven.values()) d.bone.quaternion.copy(d.rest);
    this.mixer.update(dt);

    // Procedural layer on top of the clips.
    this.updateLook(dt, resting);
    const r = this.reactionOffsets();
    const yaw = this.look.yaw;
    const pitch = this.look.pitch;
    NECK_BONES.forEach((name, i) => {
      this.rotate(name, AXIS_YAW, yaw * (NECK_YAW_SHARE[i] ?? 0));
      this.rotate(name, AXIS_RAISE_HEAD, (this.pose.neckRaise + r.neck) * (NECK_RAISE_SHARE[i] ?? 0));
    });
    this.rotate(HEAD, AXIS_YAW, yaw * HEAD_YAW_SHARE);
    this.rotate(HEAD, AXIS_RAISE_HEAD, this.pose.headPitch + pitch + r.head - 0.4 * this.pose.neckRaise);
    this.rotate(JAW, AXIS_OPEN_JAW, Math.max(0, this.pose.jaw + r.jaw));

    const t = this.time * this.pose.tailSpeed * 2;
    TAIL_BONES.forEach((name, i) => {
      const falloff = 0.4 + i * 0.09;
      this.rotate(name, AXIS_YAW, this.pose.tailAmp * Math.sin(t - i * 0.55) * falloff);
      this.rotate(name, AXIS_RAISE_TAIL, this.pose.tailLift * (i < 3 ? 0.5 : 0.15));
    });

    const flutter = this.pose.wingFlutter * Math.sin(this.time * 3.1) + r.wings;
    this.rotate(WING_UPPER.L, AXIS_ROLL, flutter);
    this.rotate(WING_UPPER.R, AXIS_ROLL, -flutter);
    return this.pose;
  }

  private updateLook(dt: number, resting: boolean): void {
    this.nextGlance -= dt;
    if (this.nextGlance <= 0) {
      const amount = this.pose.lookAround;
      this.glance = { yaw: (this.random() * 2 - 1) * 0.35 * amount, pitch: (this.random() * 2 - 1) * 0.12 * amount };
      this.nextGlance = 2 + this.random() * 3;
    }
    let yaw = this.glance.yaw * Math.min(1, this.pose.lookAround);
    let pitch = this.glance.pitch * Math.min(1, this.pose.lookAround);
    // While resting, glance toward the cursor if it moved recently.
    const recentPointer = this.pointer && this.time - this.pointer.at < 4;
    if (this.followCursor && resting && this.options.idleAnimations && recentPointer && this.pointer) {
      // Only a partial turn: a glance, not a stare.
      yaw = this.pointer.x * 0.45;
      pitch = this.pointer.y * 0.35;
    }
    const u = this.pose.lookAtUser;
    yaw = yaw * (1 - u) + this.userDirection.yaw * u;
    pitch = pitch * (1 - u) + this.userDirection.pitch * u;
    yaw = Math.max(-MAX_YAW, Math.min(MAX_YAW, yaw));
    pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch));
    const k = 1 - Math.exp(-2.4 * dt);
    this.look.yaw += (yaw - this.look.yaw) * k;
    this.look.pitch += (pitch - this.look.pitch) * k;
  }

  /** Short one-off motions: perk up, nod, celebrate, flinch. */
  private reactionOffsets(): { neck: number; head: number; jaw: number; wings: number } {
    const out = { neck: 0, head: 0, jaw: 0, wings: 0 };
    this.reactions = this.reactions.filter((r) => this.time - r.at < 1.6);
    for (const r of this.reactions) {
      const age = this.time - r.at;
      switch (r.kind) {
        case "task_started": {
          const e = age < 0.9 ? Math.sin((age / 0.9) * Math.PI) : 0;
          out.neck += 0.14 * e;
          out.head += 0.06 * e;
          break;
        }
        case "tool_started": {
          const e = age < 0.5 ? Math.sin((age / 0.5) * Math.PI) : 0;
          out.head -= 0.05 * e;
          break;
        }
        case "celebrate": {
          const e = age < 1.6 ? Math.sin((age / 1.6) * Math.PI) : 0;
          out.wings += 0.22 * e;
          out.head += 0.08 * e;
          out.jaw += 0.12 * e;
          break;
        }
        case "flinch": {
          const e = age < 0.6 ? Math.sin((age / 0.6) * Math.PI) : 0;
          out.neck -= 0.08 * e;
          break;
        }
      }
    }
    return out;
  }

  private rotate(name: string, axis: Vector3, angle: number): void {
    if (!angle) return;
    const d = this.driven.get(name);
    const local = d?.axes.get(axis);
    if (!d || !local) return;
    d.bone.quaternion.multiply(this.scratch.setFromAxisAngle(local, angle));
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    for (const d of this.driven.values()) d.bone.quaternion.copy(d.rest);
  }
}
