import {
  AnimationClip,
  Bone,
  BufferGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  QuaternionKeyframeTrack,
  Texture,
  VectorKeyframeTrack,
} from "three";
import { emitAgentEvent, type AgentEvent, type AgentEventType } from "@/agent/runtime/events";
import type { AgentStatus, AgentTask } from "@/agent/runtime/types";
import { DEFAULT_DRAGON_SETTINGS } from "@/settings/validation";
import { behaviorForStatus, TERMINAL_HOLD_MS, type DragonBehavior } from "./behavior";
import { INITIAL_COMPANION_STATE, MAX_RECENT_EVENTS, useCompanionStore } from "./companionStore";
import { DragonAnimationManager } from "./engine/animation";
import {
  boneName,
  clearDragonModelCache,
  DragonLoadError,
  HEAD,
  inspectDragon,
  loadDragonModel,
  REQUIRED_BONES,
  reportWarnings,
} from "./engine/model";
import { approach, easePose, MAX_WING_FOLD, POSES, withIdlePaused } from "./engine/poses";
import { QUALITY_PRESETS } from "./engine/quality";
import { connectDragonToAgent, describeCompanion, disconnectDragonFromAgent, reduceAgentEvent, settle } from "./eventAdapter";
import { viewerConfigFor } from "./viewerConfig";

function task(status: AgentStatus, request = "Add a /health endpoint"): AgentTask {
  return {
    id: "t1",
    conversationId: "c1",
    userRequest: request,
    model: "qwen3:8b",
    mode: "agent",
    intent: "task",
    status,
    steps: [],
    memory: [],
    changes: [],
    skills: [],
    startedAt: 0,
    iteration: 0,
    toolCalls: 0,
    retries: 0,
    usage: { promptTokens: 0, completionTokens: 0, contextBudget: 0, peakPromptTokens: 0 },
  };
}

function event(type: AgentEventType, status: AgentStatus, label: string, data?: Record<string, unknown>, at = 1000): AgentEvent {
  return { type, taskId: "t1", at, label, task: task(status), data };
}

describe("behaviorForStatus", () => {
  it("maps every runtime status to a behavior", () => {
    const expected: Record<AgentStatus, DragonBehavior> = {
      idle: "idle",
      thinking: "thinking",
      planning: "planning",
      executing: "executing",
      waiting_for_permission: "waiting",
      verifying: "verifying",
      paused: "paused",
      completed: "completed",
      failed: "failed",
      stopped: "failed",
      cancelled: "cancelled",
    };
    for (const [status, behavior] of Object.entries(expected)) {
      expect(behaviorForStatus(status as AgentStatus)).toBe(behavior);
    }
  });
});

describe("reduceAgentEvent", () => {
  const start = { ...INITIAL_COMPANION_STATE, connected: true };

  it("follows a task through tools, approval, verification, and completion", () => {
    let s = reduceAgentEvent(start, event("agent.started", "thinking", "Task started"));
    expect(s).toMatchObject({ behavior: "thinking", task: "Add a /health endpoint", activity: "Starting the task" });
    expect(s.reaction?.kind).toBe("task_started");

    s = reduceAgentEvent(s, event("agent.planning", "planning", "Planning"));
    expect(s.behavior).toBe("planning");

    s = reduceAgentEvent(s, event("agent.tool_requested", "executing", "Requested create_file", { tool: "create_file" }));
    expect(s.tool).toEqual({ name: "create_file", category: null });

    s = reduceAgentEvent(s, event("agent.permission_requested", "waiting_for_permission", "Waiting for your approval"));
    expect(s).toMatchObject({ behavior: "waiting", activity: "Waiting for your approval", tool: { name: "create_file" } });

    s = reduceAgentEvent(s, event("agent.permission_granted", "executing", "Approved"));
    s = reduceAgentEvent(
      s,
      event("agent.tool_started", "executing", "Creating src/health.ts", { tool: "create_file", category: "WRITE", stepId: "s1" }),
    );
    expect(s).toMatchObject({
      behavior: "executing",
      activity: "Creating src/health.ts",
      tool: { name: "create_file", category: "WRITE" },
    });

    s = reduceAgentEvent(s, event("agent.tool_completed", "executing", "create_file succeeded"));
    expect(s.tool).toBeNull();
    expect(s.activity).toBeNull();

    s = reduceAgentEvent(s, event("agent.verifying", "verifying", "Verifying changes"));
    expect(s).toMatchObject({ behavior: "verifying", activity: "Verifying changes" });

    s = reduceAgentEvent(s, event("agent.completed", "completed", "Completed"));
    expect(s.behavior).toBe("completed");
    expect(s.lastResult).toMatchObject({ behavior: "completed", label: "Completed" });
    expect(s.reaction?.kind).toBe("celebrate");
    expect(s.recent[0]?.type).toBe("agent.completed");
    // Model "thinking" ticks and tool requests aren't listed.
    expect(s.recent.some((e) => e.type === "agent.tool_requested")).toBe(false);
  });

  it("a failed tool does not make the dragon look like the task failed", () => {
    const s = reduceAgentEvent(start, event("agent.tool_failed", "executing", "run_command: exit code 1"));
    expect(s.behavior).toBe("executing");
    expect(s.reaction?.kind).toBe("flinch");
    expect(s.recent[0]?.tone).toBe("error");
  });

  it("limits stop the task and show as failed; cancel shows as cancelled", () => {
    expect(reduceAgentEvent(start, event("agent.stopped", "stopped", "Maximum iteration limit reached.")).behavior).toBe("failed");
    expect(reduceAgentEvent(start, event("agent.cancelled", "cancelled", "Cancelled")).behavior).toBe("cancelled");
  });

  it("keeps only the most recent events", () => {
    let s = start;
    for (let i = 0; i < MAX_RECENT_EVENTS + 5; i++) s = reduceAgentEvent(s, event("agent.tool_completed", "executing", `step ${i}`));
    expect(s.recent).toHaveLength(MAX_RECENT_EVENTS);
    expect(s.recent[0]?.label).toBe(`step ${MAX_RECENT_EVENTS + 4}`);
  });

  it("settles to idle and clears the task, keeping the last result", () => {
    const done = reduceAgentEvent(start, event("agent.completed", "completed", "Completed"));
    const rested = settle(done);
    expect(rested).toMatchObject({ behavior: "idle", task: null, agentStatus: null, tool: null });
    expect(rested.lastResult?.behavior).toBe("completed");
    expect(describeCompanion(rested)).toBe("Idle");
  });
});

describe("connectDragonToAgent", () => {
  afterEach(() => {
    disconnectDragonFromAgent();
    vi.useRealTimers();
  });

  it("mirrors runtime events and rests after a finished task", () => {
    vi.useFakeTimers();
    connectDragonToAgent();
    expect(useCompanionStore.getState().connected).toBe(true);
    emitAgentEvent(event("agent.started", "thinking", "Task started"));
    expect(useCompanionStore.getState().behavior).toBe("thinking");
    emitAgentEvent(event("agent.completed", "completed", "Completed"));
    expect(useCompanionStore.getState().behavior).toBe("completed");
    vi.advanceTimersByTime((TERMINAL_HOLD_MS.completed ?? 0) - 1);
    expect(useCompanionStore.getState().behavior).toBe("completed");
    vi.advanceTimersByTime(2);
    expect(useCompanionStore.getState()).toMatchObject({ behavior: "idle", task: null });
  });

  it("a new task cancels the pending rest", () => {
    vi.useFakeTimers();
    connectDragonToAgent();
    emitAgentEvent(event("agent.failed", "failed", "Failed"));
    emitAgentEvent(event("agent.started", "thinking", "Task started"));
    vi.advanceTimersByTime(60_000);
    expect(useCompanionStore.getState().behavior).toBe("thinking");
  });

  it("records a subscription failure instead of throwing", () => {
    connectDragonToAgent(() => {
      throw new Error("event bus unavailable");
    });
    expect(useCompanionStore.getState()).toMatchObject({ connected: false, connectionError: "event bus unavailable" });
    expect(describeCompanion(useCompanionStore.getState())).toMatch(/not connected/i);
  });
});

describe("poses", () => {
  it("define every parameter for every behavior, within the rig's comfortable range", () => {
    const keys = Object.keys(POSES.idle);
    for (const pose of Object.values(POSES)) {
      expect(Object.keys(pose).sort()).toEqual([...keys].sort());
      expect(pose.wingFold).toBeLessThanOrEqual(MAX_WING_FOLD);
      expect(pose.wingFold).toBeGreaterThanOrEqual(0);
      expect(Math.abs(pose.headPitch)).toBeLessThan(0.5);
      expect(Math.abs(pose.neckRaise)).toBeLessThan(0.5);
      expect(pose.jaw).toBeLessThan(0.2);
    }
  });

  it("waiting looks at the user; failure lowers the head", () => {
    expect(POSES.waiting.lookAtUser).toBe(1);
    expect(POSES.failed.headPitch).toBeLessThan(POSES.idle.headPitch);
    expect(POSES.failed.glow).toBeLessThan(POSES.thinking.glow);
  });

  it("eases toward targets independent of frame rate", () => {
    expect(approach(0, 1, 2, 0)).toBe(0);
    const oneStep = approach(0, 1, 2, 0.5);
    const twoSteps = approach(approach(0, 1, 2, 0.25), 1, 2, 0.25);
    expect(oneStep).toBeCloseTo(twoSteps, 10);
    let p = { ...POSES.idle };
    for (let i = 0; i < 300; i++) p = easePose(p, POSES.failed, 1 / 30);
    expect(p.headPitch).toBeCloseTo(POSES.failed.headPitch, 3);
  });

  it("pausing idle animations stills glances and tail sway", () => {
    expect(withIdlePaused(POSES.idle)).toMatchObject({ lookAround: 0, tailAmp: 0, wingFlutter: 0 });
  });
});

describe("quality presets and viewer config", () => {
  it("scale cost with quality", () => {
    const { low, medium, high } = QUALITY_PRESETS;
    expect(low.snowCount).toBeLessThan(medium.snowCount);
    expect(medium.snowCount).toBeLessThan(high.snowCount);
    expect(low.shadowMapSize).toBe(0);
    expect(low.fps).toBeLessThan(high.fps);
    expect(high.reflections && !medium.reflections && !low.reflections).toBe(true);
  });

  it("reduce visual effects turns off particles, glow, and cursor following", () => {
    const c = viewerConfigFor(DEFAULT_DRAGON_SETTINGS, true);
    expect(c).toMatchObject({ snow: false, iceParticles: false, lightingEffects: false, followCursor: false });
    expect(viewerConfigFor(DEFAULT_DRAGON_SETTINGS, false)).toMatchObject({ snow: true, lightingEffects: true });
  });
});

/** A minimal stand-in for the GLB: the required bones, one mesh, three clips. */
function fakeDragon(options: { textured?: boolean } = {}) {
  const root = new Group();
  root.name = "Vinnie_Dragon_Rig";
  const bones = new Map<string, Bone>();
  let parent: Group | Bone = root;
  for (const name of REQUIRED_BONES) {
    const b = new Bone();
    b.name = name;
    b.position.set(0, 0.3, 0.1);
    parent.add(b);
    bones.set(name, b);
    if (name.startsWith("neck") || name === boneName("chest")) parent = b;
  }
  for (const name of ["eyelid_upper.L", "eyelid_upper.R", "eyelid_lower.L", "eyelid_lower.R", "wing_forearm.L"].map(boneName)) {
    const b = new Bone();
    b.name = name;
    root.add(b);
  }
  const material = new MeshStandardMaterial({ name: "M_Dragon_Scales" });
  if (options.textured) {
    material.map = new Texture();
    material.normalMap = new Texture();
    material.roughnessMap = new Texture();
    material.emissiveMap = new Texture();
  }
  const mesh = new Mesh(new BufferGeometry(), material);
  mesh.name = "Dragon_Body";
  root.add(mesh);

  const q = (axisZ: number) => new Quaternion().setFromAxisAngle({ x: 0, y: 0, z: 1 } as never, axisZ).toArray();
  const track = (bone: string, a: number) =>
    new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [...q(0), ...q(a)]);
  const clips = [
    new AnimationClip("Idle_Breathe", 1, [
      track(boneName("chest"), 0.1),
      track(boneName("wing_upper.L"), 0.5),
      track(boneName("eyelid_upper.L"), 0.5),
      new VectorKeyframeTrack(`${boneName("chest")}.scale`, [0, 1], [1, 1, 1, 1.03, 1, 1.03]),
    ]),
    new AnimationClip("Blink", 0.4, [track(boneName("eyelid_upper.L"), 0.7), track(boneName("chest"), 0.9)]),
    new AnimationClip("Wings_Fold", 1.6, [track(boneName("wing_upper.L"), 1.2), track(boneName("head"), 0.9)]),
  ];
  return { root, bones, clips };
}

describe("model inspection", () => {
  it("accepts a complete dragon", () => {
    const { root, clips } = fakeDragon({ textured: true });
    const report = inspectDragon(root, clips);
    expect(report).toMatchObject({ missingBones: [], missingClips: [], missingTextures: [], meshes: 1 });
    expect(reportWarnings(report)).toEqual([]);
  });

  it("reports missing textures, clips, and bones", () => {
    const { root } = fakeDragon();
    root.getObjectByName(HEAD)?.removeFromParent();
    const report = inspectDragon(root, []);
    expect(report.missingTextures).toContain("M_Dragon_Scales: map");
    expect(report.missingClips).toEqual(["Idle_Breathe", "Blink", "Wings_Fold"]);
    expect(report.missingBones).toEqual([HEAD]);
    expect(reportWarnings(report)).toHaveLength(3);
  });

  it("uses the names GLTFLoader produces (dots removed)", () => {
    expect(boneName("eye.L")).toBe("eyeL");
    expect(boneName("wing_upper.R")).toBe("wing_upperR");
  });
});

describe("DragonAnimationManager", () => {
  it("keeps clips on their own body parts so they can play together", () => {
    const { root, clips } = fakeDragon({ textured: true });
    const manager = new DragonAnimationManager(root, clips);
    const actions = (manager.mixer as unknown as { _actions: { getClip(): AnimationClip }[] })._actions;
    const tracksOf = (name: string) => actions.find((a) => a.getClip().name === name)?.getClip().tracks.map((t) => t.name) ?? [];
    expect(tracksOf("idle_body")).toEqual([`${boneName("chest")}.quaternion`, `${boneName("chest")}.scale`]);
    expect(tracksOf("wings_fold")).toEqual([`${boneName("wing_upper.L")}.quaternion`]);
    expect(manager.hasClips).toEqual({ idle: true, blink: true, fold: true });
    manager.dispose();
  });

  it("moves toward the failed posture and holds still when idle animations are paused", () => {
    const { root, bones, clips } = fakeDragon({ textured: true });
    const manager = new DragonAnimationManager(root, clips);
    const head = bones.get(HEAD)!;
    manager.setBehavior("failed");
    for (let i = 0; i < 120; i++) manager.update(1 / 30);
    expect(manager.currentPose.headPitch).toBeCloseTo(POSES.failed.headPitch, 2);
    expect(head.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1);

    manager.setBehavior("idle");
    manager.setOptions({ idleAnimations: false, speed: 1 });
    for (let i = 0; i < 400; i++) manager.update(1 / 30);
    const tail = bones.get(boneName("tail_05"))!;
    const before = tail.quaternion.clone();
    for (let i = 0; i < 30; i++) manager.update(1 / 30);
    expect(tail.quaternion.angleTo(before)).toBeLessThan(1e-3);
    manager.dispose();
  });

  it("turns toward the user while waiting for permission", () => {
    const { root, clips } = fakeDragon({ textured: true });
    const manager = new DragonAnimationManager(root, clips);
    manager.setUserDirection(0.4, 0);
    manager.setBehavior("waiting");
    for (let i = 0; i < 150; i++) manager.update(1 / 30);
    expect(manager.currentPose.lookAtUser).toBeCloseTo(1, 2);
    manager.dispose();
  });

  it("works without any clips (procedural motion only)", () => {
    const { root } = fakeDragon();
    const manager = new DragonAnimationManager(root, []);
    expect(manager.hasClips).toEqual({ idle: false, blink: false, fold: false });
    expect(() => {
      for (let i = 0; i < 30; i++) manager.update(1 / 30);
    }).not.toThrow();
    manager.dispose();
  });
});

describe("loadDragonModel", () => {
  afterEach(() => {
    clearDragonModelCache();
    vi.unstubAllGlobals();
  });

  it("reports a missing model file and retries on the next call", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(loadDragonModel("/models/vinnie_dragon.glb")).rejects.toMatchObject({ kind: "missing" });
    await expect(loadDragonModel("/models/vinnie_dragon.glb")).rejects.toBeInstanceOf(DragonLoadError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports an invalid model file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new Uint8Array([1, 2, 3, 4]), { status: 200 })));
    await expect(loadDragonModel("/models/vinnie_dragon.glb")).rejects.toMatchObject({ kind: "invalid" });
  });
});
