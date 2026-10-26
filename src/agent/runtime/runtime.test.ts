import { waitFor } from "@testing-library/react";
import { VinnieError } from "@/lib/errors";
import type { NewMessage, RunResult } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useSettingsStore } from "@/state/settingsStore";
import { installFakes, resetStores, type FakeStream } from "@/test/fakes";
import { createToolRegistry } from "../toolRegistry";
import { registerWorkspaceTools } from "../tools";
import type { ApprovalDecision, ApprovalRequest } from "../types";
import { onAgentEvent, type AgentEvent } from "./events";
import { PermissionManager } from "./permissionManager";
import { AgentRuntime, type RunInput, type RuntimeDeps } from "./runtime";
import { DEFAULT_LIMITS, type AgentLimits, type AgentMode } from "./types";

let fakes: ReturnType<typeof installFakes>;
let persisted: NewMessage[];
let prompts: ApprovalRequest[];
let decide: (r: ApprovalRequest) => ApprovalDecision;
let permissions: PermissionManager;
let stopCommands: ReturnType<typeof vi.fn<() => void>>;
let events: AgentEvent[];
let unsubscribe: () => void;

beforeEach(() => {
  resetStores();
  fakes = installFakes();
  fakes.ws.files.clear();
  fakes.ws.files.set("README.md", "# Demo\n");
  persisted = [];
  prompts = [];
  decide = () => ({ approved: true });
  permissions = new PermissionManager();
  stopCommands = vi.fn<() => void>();
  events = [];
  unsubscribe = onAgentEvent((e) => events.push(e));
});

afterEach(() => unsubscribe());

function makeRuntime(request: string, opts: { mode?: AgentMode; limits?: Partial<AgentLimits>; autoVerify?: boolean } = {}) {
  const registry = createToolRegistry();
  registerWorkspaceTools(registry);
  const deps: RuntimeDeps = {
    provider: fakes.provider,
    registry,
    services: getServices(),
    permissions,
    settings: () => useSettingsStore.getState().settings,
    prompt: async (r) => {
      prompts.push(r);
      return decide(r);
    },
    runCommand: (r) =>
      getServices().process.run(
        { runId: "run-1", command: r.command, actor: "assistant", approved: r.approved, remember: r.remember },
        () => {},
      ) as Promise<RunResult>,
    stopCommands,
    filesChanged: () => {},
    projectChanged: () => {},
    metadata: () => null,
    refreshMetadata: async () => null,
    persist: async (m) => {
      persisted.push(m);
    },
    stream: { reset() {}, started() {}, content() {}, thinking() {} },
    modelContextLength: async () => null,
    onUpdate: () => {},
    notice: vi.fn(),
    sleep: async () => {},
  };
  const input: RunInput = {
    conversationId: "conv-1",
    request,
    model: "qwen3:8b",
    history: [],
    project: null,
    workspaceRoot: "C:\\Projects\\demo",
    mode: opts.mode ?? "agent",
    limits: { ...DEFAULT_LIMITS, ...opts.limits },
    autoVerify: opts.autoVerify ?? true,
    toolsEnabled: true,
  };
  return new AgentRuntime(deps, input);
}

async function stream(n: number): Promise<FakeStream> {
  await waitFor(() => expect(fakes.provider.streams).toHaveLength(n));
  return fakes.provider.lastStream();
}

function reply(s: FakeStream, text: string) {
  s.emit({ type: "content", text });
  s.complete();
}

function call(s: FakeStream, name: string, args: Record<string, unknown>) {
  s.callTool(name, args);
  s.complete();
}

const toolNames = (s: FakeStream) => (s.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);

describe("agent loop", () => {
  it("answers a simple question without planning, verification, or a report", async () => {
    const rt = makeRuntime("What does this project do?");
    const done = rt.run();
    reply(await stream(1), "It's a demo.");
    const task = await done;
    expect(task.intent).toBe("question");
    expect(task.status).toBe("completed");
    expect(task.result?.reason).toBe("Answered.");
    expect(task.result?.verification).toBeNull();
    expect(persisted.map((m) => m.role)).toEqual(["assistant"]);
    expect(events.map((e) => e.type)).toContain("agent.completed");
  });

  it("runs a task end to end: plan, approval, change, verification, report", async () => {
    const rt = makeRuntime("Create a CHANGELOG.md file");
    const done = rt.run();
    const s1 = await stream(1);
    expect(rt.task.status).toBe("planning");
    call(s1, "update_plan", { steps: [{ title: "Create CHANGELOG.md" }, { title: "Verify" }] });
    call(await stream(2), "create_file", { path: "CHANGELOG.md", content: "# Changelog\n" });
    call(await stream(3), "update_plan", {
      steps: [
        { title: "Create CHANGELOG.md", status: "done" },
        { title: "Verify", status: "done" },
      ],
    });
    reply(await stream(4), "Created CHANGELOG.md.");
    const task = await done;

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toMatchObject({ kind: "file" });
    expect(fakes.ws.files.get("CHANGELOG.md")).toBe("# Changelog\n");
    expect(task.plan?.steps.map((s) => s.title)).toEqual(["Create CHANGELOG.md", "Verify"]);
    expect(task.status).toBe("completed");
    expect(task.result?.verification?.success).toBe(true);
    expect(task.result?.changes).toMatchObject({ files: 1, paths: ["CHANGELOG.md"] });
    const report = persisted.at(-1)!;
    expect(report.model).toBeNull();
    expect(report.content).toContain("**Task report**");
    expect(report.content).toContain("CHANGELOG.md");
    expect(events.map((e) => e.type)).toEqual(
      expect.arrayContaining(["agent.started", "agent.planning", "agent.plan_updated", "agent.permission_requested", "agent.verifying", "agent.verification_passed", "agent.completed"]),
    );
  });

  it("does not let the model claim success when verification keeps failing", async () => {
    const rt = makeRuntime("Create config.json with the settings", { limits: { maxRetries: 1 } });
    const done = rt.run();
    call(await stream(1), "create_file", { path: "config.json", content: "{ broken" });
    reply(await stream(2), "Done! Everything works perfectly.");
    // Verification failed: the failure is fed back for a repair attempt.
    const s3 = await stream(3);
    expect(s3.messages.at(-1)?.content).toMatch(/verification failed/i);
    reply(s3, "All fixed, it definitely works now.");
    const task = await done;
    expect(task.status).toBe("failed");
    expect(task.result?.reason).toMatch(/Verification still failed/);
    expect(task.result?.verification?.success).toBe(false);
  });

  it("repairs after a failed verification and then succeeds", async () => {
    const rt = makeRuntime("Create config.json");
    const done = rt.run();
    call(await stream(1), "create_file", { path: "config.json", content: "{ broken" });
    reply(await stream(2), "Done.");
    call(await stream(3), "write_file", { path: "config.json", content: '{ "ok": true }\n' });
    reply(await stream(4), "Fixed the JSON.");
    const task = await done;
    expect(task.status).toBe("completed");
    expect(task.retries).toBeGreaterThanOrEqual(1);
    expect(task.result?.verification?.success).toBe(true);
  });

  it("stops at the iteration limit", async () => {
    const rt = makeRuntime("Fix the readme", { limits: { maxIterations: 2 } });
    const done = rt.run();
    call(await stream(1), "read_file", { path: "README.md" });
    call(await stream(2), "read_file", { path: "README.md", startLine: 1 });
    const task = await done;
    expect(fakes.provider.streams).toHaveLength(2);
    expect(task.status).toBe("stopped");
    expect(task.result?.reason).toBe("Maximum iteration limit reached.");
  });

  it("stops at the tool call limit", async () => {
    const rt = makeRuntime("Fix the readme", { limits: { maxToolCalls: 1 } });
    const done = rt.run();
    const s = await stream(1);
    s.callTool("read_file", { path: "README.md" });
    s.callTool("search_files", { query: "Demo" });
    s.complete();
    const task = await done;
    expect(task.status).toBe("stopped");
    expect(task.result?.reason).toBe("Maximum tool call limit reached.");
    expect(task.toolCalls).toBe(1);
  });

  it("stops when too many files change", async () => {
    const rt = makeRuntime("Create notes", { limits: { maxChangedFiles: 1 } });
    decide = () => ({ approved: true, scope: "task" });
    const done = rt.run();
    const s = await stream(1);
    s.callTool("create_file", { path: "a.md", content: "a" });
    s.callTool("create_file", { path: "b.md", content: "b" });
    s.complete();
    const task = await done;
    expect(task.status).toBe("stopped");
    expect(task.result?.reason).toMatch(/changed files limit/);
  });
});

describe("tool failures and recovery", () => {
  it("refuses unknown tools and keeps going", async () => {
    const rt = makeRuntime("Fix the readme");
    const done = rt.run();
    call(await stream(1), "format_hard_drive", {});
    const s2 = await stream(2);
    expect(s2.messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("unknown tool: format_hard_drive") });
    reply(s2, "I can't do that.");
    reply(await stream(3), "There is no such tool, so nothing changed.");
    const task = await done;
    expect(task.steps.some((s) => s.status === "failed")).toBe(true);
  });

  it("rejects invalid tool arguments without executing", async () => {
    const rt = makeRuntime("Create a file");
    const done = rt.run();
    call(await stream(1), "create_file", { path: 42 });
    const s2 = await stream(2);
    expect(s2.messages.at(-1)?.content).toMatch(/Invalid input for create_file/);
    expect(prompts).toHaveLength(0);
    reply(s2, "Oops.");
    reply(await stream(3), "Nothing changed.");
    await done;
  });

  it("never repeats the same failing call forever", async () => {
    const rt = makeRuntime("Fix missing.lua", { limits: { maxRetries: 1 } });
    const done = rt.run();
    call(await stream(1), "read_file", { path: "missing.lua" });
    call(await stream(2), "read_file", { path: "missing.lua" });
    call(await stream(3), "read_file", { path: "missing.lua" });
    const s4 = await stream(4);
    expect(s4.messages.at(-1)?.content).toMatch(/already failed 2 times/);
    // A different action is allowed.
    call(s4, "search_files", { query: "missing" });
    const s5 = await stream(5);
    expect(s5.messages.at(-1)?.content).not.toMatch(/already failed/);
    reply(s5, "missing.lua does not exist.");
    reply(await stream(6), "No change is possible: missing.lua does not exist.");
    const task = await done;
    expect(task.memory.some((m) => m.includes("FILE_NOT_FOUND"))).toBe(true);
  });

  it("records a denied permission and tells the model not to retry", async () => {
    decide = () => ({ approved: false });
    const rt = makeRuntime("Create notes.md");
    const done = rt.run();
    call(await stream(1), "create_file", { path: "notes.md", content: "x" });
    const s2 = await stream(2);
    expect(s2.messages.at(-1)?.content).toMatch(/denied/i);
    expect(s2.messages[0]?.content).toContain("User denied");
    reply(s2, "Okay, I won't create it.");
    const task = await done;
    expect(fakes.ws.files.has("notes.md")).toBe(false);
    expect(task.steps.some((s) => s.kind === "permission" && s.status === "denied")).toBe(true);
  });
});

describe("model failures", () => {
  it("retries transient failures before any output", async () => {
    const rt = makeRuntime("What is this?");
    const done = rt.run();
    (await stream(1)).fail(new VinnieError("interrupted", "Connection closed."));
    reply(await stream(2), "A demo project.");
    const task = await done;
    expect(task.status).toBe("completed");
    expect(task.retries).toBe(1);
  });

  it("fails cleanly on a permanent model error and keeps the error", async () => {
    const rt = makeRuntime("What is this?");
    const done = rt.run();
    (await stream(1)).fail(new VinnieError("model_not_found", "Model qwen3:8b is not installed."));
    const task = await done;
    expect(task.status).toBe("failed");
    expect(rt.modelError?.kind).toBe("model_not_found");
    expect(fakes.provider.streams).toHaveLength(1);
  });

  it("falls back to plain chat when the model cannot use tools", async () => {
    const rt = makeRuntime("Fix the readme");
    const done = rt.run();
    (await stream(1)).fail(new VinnieError("tools_unsupported", "no tools"));
    const s2 = await stream(2);
    expect(s2.tools).toBeUndefined();
    reply(s2, "Here's how to fix it.");
    expect((await done).status).toBe("completed");
  });

  it("recovers tool calls the model wrote as text", async () => {
    const rt = makeRuntime("Show me the readme");
    const done = rt.run();
    reply(await stream(1), '<tool_call>{"name": "read_file", "arguments": {"path": "README.md"}}</tool_call>');
    const s2 = await stream(2);
    expect(s2.messages.at(-1)).toMatchObject({ role: "tool", content: expect.stringContaining("# Demo") });
    reply(s2, "It says Demo.");
    await done;
  });
});

describe("honest outcomes", () => {
  it("tells the model when it only wrote tool calls as text, and they did not run", async () => {
    const rt = makeRuntime("Add a /health endpoint to server.js");
    const done = rt.run();
    reply(
      await stream(1),
      'Step 1:\n```json\n{"name": "write_file", "arguments": {"path": "server.js", "content": "x"}}\n```\nDone!',
    );
    const s2 = await stream(2);
    expect(s2.messages.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("were executed") });
    expect(prompts).toHaveLength(0);
    reply(s2, "Sorry, I can't.");
    reply(await stream(3), "No change needed.");
    const task = await done;
    expect(task.status).toBe("completed");
    expect(task.result?.reason).toBe("No files were changed.");
    expect(persisted.at(-1)?.content).toContain("ℹ Task finished. No files were changed.");
    expect(fakes.ws.files.has("server.js")).toBe(false);
  });
});

describe("tasks that end without changes", () => {
  it("reports plan steps the model left unfinished", async () => {
    const rt = makeRuntime("Create notes.md and a test", { autoVerify: false });
    const done = rt.run();
    call(await stream(1), "update_plan", { steps: [{ title: "Create notes.md" }, { title: "Add a test" }] });
    call(await stream(2), "create_file", { path: "notes.md", content: "x" });
    reply(await stream(3), "All done!");
    const s4 = await stream(4);
    expect(s4.messages.at(-1)?.content).toMatch(/not marked done: "Create notes.md", "Add a test"/);
    reply(s4, "Yes, everything is done.");
    const task = await done;
    expect(task.status).toBe("completed");
    expect(task.result?.reason).toMatch(/Plan steps not marked done: Create notes.md; Add a test\./);
  });

  it("asks the model once to continue when it stops with nothing changed", async () => {
    const rt = makeRuntime("Create notes.md", { limits: { maxRetries: 1 } });
    const done = rt.run();
    call(await stream(1), "update_plan", { steps: [{ title: "Create notes.md" }] });
    reply(await stream(2), "Next step: create notes.md.");
    const s3 = await stream(3);
    expect(s3.messages.at(-1)?.content).toMatch(/No files have been changed yet and your plan's next step is "Create notes.md"/);
    reply(s3, "Still thinking.");
    // Bounded: only one nudge per task.
    const task = await done;
    expect(fakes.provider.streams).toHaveLength(3);
    expect(task.result?.reason).toBe("No files were changed. Plan steps not marked done: Create notes.md.");
  });
});

describe("cancellation, pause, and modes", () => {
  it("cancels a running model request and stops started commands", async () => {
    const rt = makeRuntime("Fix the readme");
    const done = rt.run();
    const s = await stream(1);
    s.emit({ type: "content", text: "Working on" });
    rt.cancel();
    const task = await done;
    expect(s.cancelled).toBe(true);
    expect(stopCommands).toHaveBeenCalled();
    expect(task.status).toBe("cancelled");
    expect(persisted.find((m) => m.content === "Working on")?.status).toBe("interrupted");
    expect(events.at(-1)?.type).toBe("agent.cancelled");
  });

  it("denies pending approvals when cancelled during a permission prompt", async () => {
    let resolvePrompt!: (d: ApprovalDecision) => void;
    const rt = makeRuntime("Create notes.md");
    // Hold the prompt open until cancel.
    (rt as unknown as { deps: RuntimeDeps }).deps.prompt = (r) => {
      prompts.push(r);
      return new Promise((resolve) => (resolvePrompt = resolve));
    };
    const done = rt.run();
    call(await stream(1), "create_file", { path: "notes.md", content: "x" });
    await waitFor(() => expect(rt.task.status).toBe("waiting_for_permission"));
    rt.cancel();
    resolvePrompt({ approved: false });
    const task = await done;
    expect(task.status).toBe("cancelled");
    expect(fakes.ws.files.has("notes.md")).toBe(false);
  });

  it("pauses between steps and resumes", async () => {
    const rt = makeRuntime("Fix the readme");
    const done = rt.run();
    const s1 = await stream(1);
    rt.pause();
    expect(rt.task.status).toBe("paused");
    call(s1, "read_file", { path: "README.md" });
    await new Promise((r) => setTimeout(r, 30));
    expect(fakes.provider.streams).toHaveLength(1);
    rt.resume();
    reply(await stream(2), "Read it.");
    reply(await stream(3), "The readme is already fine.");
    const task = await done;
    expect(task.status).toBe("completed");
    expect(task.steps.some((s) => s.title === "Paused by the user")).toBe(true);
  });

  it("offers only read-only tools in Ask mode and refuses writes", async () => {
    const rt = makeRuntime("Create notes.md", { mode: "ask" });
    const done = rt.run();
    const s1 = await stream(1);
    expect(toolNames(s1)).not.toContain("create_file");
    expect(toolNames(s1)).toContain("read_file");
    call(s1, "create_file", { path: "notes.md", content: "x" });
    const s2 = await stream(2);
    expect(s2.messages.at(-1)?.content).toMatch(/not available for this task/);
    reply(s2, "I'm in Ask mode.");
    await done;
    expect(fakes.ws.files.has("notes.md")).toBe(false);
    expect(prompts).toHaveLength(0);
  });

  it("asks before every write in Assist mode even when writes are allowed", async () => {
    const settings = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...settings, permissions: { ...settings.permissions, write: "allowed" } } });
    const rt = makeRuntime("Create notes.md", { mode: "assist", autoVerify: false });
    const done = rt.run();
    call(await stream(1), "create_file", { path: "notes.md", content: "x" });
    reply(await stream(2), "Created.");
    const task = await done;
    expect(prompts).toHaveLength(1);
    expect(task.result?.reason).toMatch(/verification is turned off/);
  });

  it("task-scoped grants expire when the task ends", async () => {
    decide = () => ({ approved: true, scope: "task" });
    const rt = makeRuntime("Create notes");
    const done = rt.run();
    const s = await stream(1);
    s.callTool("create_file", { path: "a.md", content: "a" });
    s.callTool("create_file", { path: "b.md", content: "b" });
    s.complete();
    reply(await stream(2), "Created both.");
    await done;
    expect(prompts).toHaveLength(1);
    expect(permissions.list()).toHaveLength(0);
  });
});
