// The dragon against the real AgentRuntime: after every runtime event the
// dragon's behavior must match the task's actual status.

import { waitFor } from "@testing-library/react";
import { VinnieError } from "@/lib/errors";
import type { RunResult } from "@/lib/ipc/types";
import { createToolRegistry } from "@/agent/toolRegistry";
import { registerWorkspaceTools } from "@/agent/tools";
import type { ApprovalDecision, ApprovalRequest } from "@/agent/types";
import { onAgentEvent } from "@/agent/runtime/events";
import { PermissionManager } from "@/agent/runtime/permissionManager";
import { AgentRuntime, type RuntimeDeps } from "@/agent/runtime/runtime";
import { DEFAULT_LIMITS } from "@/agent/runtime/types";
import { getServices } from "@/services";
import { useSettingsStore } from "@/state/settingsStore";
import { installFakes, resetStores, type FakeStream } from "@/test/fakes";
import { behaviorForStatus, type DragonBehavior } from "./behavior";
import { useCompanionStore } from "./companionStore";
import { connectDragonToAgent, disconnectDragonFromAgent } from "./eventAdapter";

let fakes: ReturnType<typeof installFakes>;
let decide: (r: ApprovalRequest) => ApprovalDecision | Promise<ApprovalDecision>;
let trace: { event: string; status: string; dragon: DragonBehavior; tool: string | null }[];
let mismatches: string[];
let stop: () => void;

beforeEach(() => {
  resetStores();
  fakes = installFakes();
  fakes.ws.files.clear();
  fakes.ws.files.set("README.md", "# Demo\n");
  decide = () => ({ approved: true });
  trace = [];
  mismatches = [];
  connectDragonToAgent();
  // Subscribed after the adapter, so this sees the dragon's state for each event.
  stop = onAgentEvent((e) => {
    const s = useCompanionStore.getState();
    trace.push({ event: e.type, status: e.task.status, dragon: s.behavior, tool: s.tool?.name ?? null });
    if (s.behavior !== behaviorForStatus(e.task.status)) mismatches.push(`${e.type}: ${e.task.status} vs ${s.behavior}`);
    if (s.taskId !== e.taskId) mismatches.push(`${e.type}: task id`);
  });
});

afterEach(() => {
  stop();
  disconnectDragonFromAgent();
});

function makeRuntime(request: string) {
  const registry = createToolRegistry();
  registerWorkspaceTools(registry);
  const deps: RuntimeDeps = {
    provider: fakes.provider,
    registry,
    services: getServices(),
    permissions: new PermissionManager(),
    settings: () => useSettingsStore.getState().settings,
    prompt: async (r) => decide(r),
    runCommand: (r) =>
      getServices().process.run(
        { runId: "run-1", command: r.command, actor: "assistant", approved: r.approved, remember: r.remember },
        () => {},
      ) as Promise<RunResult>,
    stopCommands: () => {},
    filesChanged: () => {},
    projectChanged: () => {},
    metadata: () => null,
    refreshMetadata: async () => null,
    persist: async () => {},
    stream: { reset() {}, started() {}, content() {}, thinking() {} },
    modelContextLength: async () => null,
    onUpdate: () => {},
    notice: () => {},
    sleep: async () => {},
  };
  return new AgentRuntime(deps, {
    conversationId: "conv-1",
    request,
    model: "qwen3:8b",
    history: [],
    project: null,
    workspaceRoot: "C:\\Projects\\demo",
    mode: "agent",
    limits: { ...DEFAULT_LIMITS },
    autoVerify: true,
    toolsEnabled: true,
    skills: [],
  });
}

async function stream(n: number): Promise<FakeStream> {
  await waitFor(() => expect(fakes.provider.streams).toHaveLength(n));
  return fakes.provider.lastStream();
}
const call = (s: FakeStream, name: string, args: Record<string, unknown>) => {
  s.callTool(name, args);
  s.complete();
};
const reply = (s: FakeStream, text: string) => {
  s.emit({ type: "content", text });
  s.complete();
};

describe("dragon follows the real agent runtime", () => {
  it("inspect, approve an edit, verify, complete", async () => {
    let seenWhileWaiting: { behavior: DragonBehavior; tool: string | null } | null = null;
    decide = () => {
      const s = useCompanionStore.getState();
      seenWhileWaiting = { behavior: s.behavior, tool: s.tool?.name ?? null };
      return { approved: true };
    };
    const rt = makeRuntime("Create a CHANGELOG.md file");
    const done = rt.run();
    call(await stream(1), "update_plan", { steps: [{ title: "Read the readme" }, { title: "Create CHANGELOG.md" }] });
    call(await stream(2), "read_file", { path: "README.md" });
    call(await stream(3), "create_file", { path: "CHANGELOG.md", content: "# Changelog\n" });
    call(await stream(4), "update_plan", {
      steps: [
        { title: "Read the readme", status: "done" },
        { title: "Create CHANGELOG.md", status: "done" },
      ],
    });
    reply(await stream(5), "Created CHANGELOG.md.");
    const task = await done;

    expect(task.status).toBe("completed");
    expect(mismatches).toEqual([]);
    const behaviors = new Set(trace.map((t) => t.dragon));
    for (const b of ["planning", "executing", "waiting", "verifying", "completed"] as const) expect(behaviors).toContain(b);
    expect(seenWhileWaiting).toEqual({ behavior: "waiting", tool: "create_file" });
    const reading = trace.find((t) => t.event === "agent.tool_started" && t.tool === "read_file");
    expect(reading?.dragon).toBe("executing");
    expect(useCompanionStore.getState().lastResult?.behavior).toBe("completed");
  });

  it("a denied permission is shown, then the task carries on", async () => {
    decide = () => ({ approved: false });
    const rt = makeRuntime("Create notes.md");
    const done = rt.run();
    call(await stream(1), "create_file", { path: "notes.md", content: "x" });
    reply(await stream(2), "You declined, so I left it.");
    await done;
    expect(mismatches).toEqual([]);
    expect(useCompanionStore.getState().recent.some((e) => e.type === "agent.permission_denied")).toBe(true);
  });

  it("a model error fails the task and the dragon shows it", async () => {
    const rt = makeRuntime("What is this?");
    const done = rt.run();
    (await stream(1)).fail(new VinnieError("model_not_found", "Model qwen3:8b is not installed."));
    expect((await done).status).toBe("failed");
    expect(mismatches).toEqual([]);
    expect(useCompanionStore.getState().behavior).toBe("failed");
  });

  it("cancelling an active task shows cancelled", async () => {
    const rt = makeRuntime("Fix the readme");
    const done = rt.run();
    const s = await stream(1);
    s.emit({ type: "content", text: "Working on" });
    expect(useCompanionStore.getState().behavior).not.toBe("idle");
    rt.cancel();
    expect((await done).status).toBe("cancelled");
    expect(mismatches).toEqual([]);
    expect(useCompanionStore.getState()).toMatchObject({ behavior: "cancelled", tool: null, activity: null });
  });
});
