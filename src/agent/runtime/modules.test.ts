import type { ChatTurn, PermissionSettings, RunResult } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { installFakes, resetStores } from "@/test/fakes";
import type { ApprovalDecision, ApprovalRequest, ToolDefinition } from "../types";
import { buildContext, compressToolResult } from "./contextManager";
import { dragonStateFor } from "./events";
import { TaskMemory, MAX_FACTS } from "./memory";
import { PermissionManager } from "./permissionManager";
import { applyPlanUpdate, classifyIntent, editPlanStep, removePlanStep, renderPlan, selectTools } from "./planner";
import { callSignature, classifyErrorKind, isTransientModelError, RetryGuard } from "./recovery";
import { redact, redactText } from "./redact";
import { estimateMessages, OUTPUT_RESERVE, resolveContextBudget } from "./tokens";
import { chooseCommands, VerificationEngine } from "./verification";

const command = (cmd: string): ApprovalRequest => ({
  kind: "command",
  command: cmd,
  workspace: "C:\\p",
  cwd: null,
  reason: null,
  assessment: { risk: "medium", reason: "", category: "other", changesDependencies: false } as never,
});
const fileReq: ApprovalRequest = {
  kind: "file",
  operation: { kind: "modify", path: "a.ts", content: "x" } as never,
  preview: {} as never,
  reason: null,
  workspace: "C:\\p",
};
const APPROVAL: PermissionSettings = { read: "allowed", write: "approval", execute: "approval", installDependencies: "approval" };

describe("permission manager", () => {
  const authorize = (
    pm: PermissionManager,
    request: ApprovalRequest,
    capability: "write" | "delete" | "execute" | "install" | "read",
    decision: ApprovalDecision | (() => ApprovalDecision),
    over: Partial<{ mode: "ask" | "assist" | "agent"; permissions: PermissionSettings; taskId: string; workspace: string }> = {},
  ) => {
    const prompt = vi.fn(async () => (typeof decision === "function" ? decision() : decision));
    const result = pm.authorize({
      request,
      capability,
      mode: over.mode ?? "agent",
      permissions: over.permissions ?? APPROVAL,
      taskId: over.taskId ?? "t1",
      workspace: over.workspace ?? "C:\\p",
      prompt,
    });
    return { result, prompt };
  };

  it("asks the user and honors approval and denial", async () => {
    const pm = new PermissionManager();
    const yes = authorize(pm, command("npm test"), "execute", { approved: true });
    expect(await yes.result).toMatchObject({ approved: true, prompted: true, scope: "once" });
    const no = authorize(pm, command("npm test"), "execute", { approved: false });
    expect(await no.result).toMatchObject({ approved: false, prompted: true });
    expect(pm.list()).toHaveLength(0);
  });

  it("refuses without asking when settings deny, and in Ask mode", async () => {
    const pm = new PermissionManager();
    const denied = authorize(pm, fileReq, "write", { approved: true }, { permissions: { ...APPROVAL, write: "denied" } });
    expect(await denied.result).toMatchObject({ approved: false, prompted: false });
    expect(denied.prompt).not.toHaveBeenCalled();
    const ask = authorize(pm, fileReq, "write", { approved: true }, { mode: "ask" });
    expect((await ask.result).reason).toMatch(/Ask mode/);
    expect(ask.prompt).not.toHaveBeenCalled();
  });

  it("task grants apply to the same task only and expire with it", async () => {
    const pm = new PermissionManager();
    await authorize(pm, command("npm test"), "execute", { approved: true, scope: "task" }).result;
    const again = authorize(pm, command("npm test"), "execute", { approved: false });
    expect(await again.result).toMatchObject({ approved: true, prompted: false });
    const otherTask = authorize(pm, command("npm test"), "execute", { approved: false }, { taskId: "t2" });
    expect(await otherTask.result).toMatchObject({ approved: false, prompted: true });
    const otherCommand = authorize(pm, command("npm run build"), "execute", { approved: false });
    expect((await otherCommand.result).prompted).toBe(true);
    pm.endTask("t1");
    expect(pm.list()).toHaveLength(0);
  });

  it("session grants span tasks but not workspaces, and clear with the session", async () => {
    const pm = new PermissionManager();
    await authorize(pm, fileReq, "write", { approved: true, scope: "session" }).result;
    expect(await authorize(pm, fileReq, "write", { approved: false }, { taskId: "t9" }).result).toMatchObject({ approved: true, prompted: false });
    expect((await authorize(pm, fileReq, "write", { approved: false }, { workspace: "C:\\other" }).result).prompted).toBe(true);
    pm.clearSession();
    expect((await authorize(pm, fileReq, "write", { approved: false }).result).prompted).toBe(true);
  });

  it("never remembers deletions or secret reads, and Assist mode always asks", async () => {
    const pm = new PermissionManager();
    await authorize(pm, fileReq, "delete", { approved: true, scope: "session" }).result;
    expect(pm.list()).toHaveLength(0);
    expect((await authorize(pm, fileReq, "delete", { approved: false }).result).prompted).toBe(true);
    const allowed = { ...APPROVAL, write: "allowed" as const };
    expect((await authorize(pm, fileReq, "write", { approved: true }, { permissions: allowed }).result).prompted).toBe(false);
    expect((await authorize(pm, fileReq, "write", { approved: true }, { permissions: allowed, mode: "assist" }).result).prompted).toBe(true);
  });
});

describe("recovery", () => {
  it("classifies backend errors", () => {
    expect(classifyErrorKind("not_found")).toBe("FILE_NOT_FOUND");
    expect(classifyErrorKind("blocked")).toBe("PERMISSION_DENIED");
    expect(classifyErrorKind("timeout")).toBe("COMMAND_TIMEOUT");
    expect(isTransientModelError("interrupted")).toBe(true);
    expect(isTransientModelError("model_not_found")).toBe(false);
  });

  it("allows a bounded number of identical retries", () => {
    const guard = new RetryGuard(1);
    const sig = callSignature("read_file", { path: "a", startLine: 1 });
    expect(callSignature("read_file", { startLine: 1, path: "a" })).toBe(sig);
    expect(guard.allows(sig)).toBe(true);
    guard.recordFailure(sig);
    expect(guard.allows(sig)).toBe(true);
    guard.recordFailure(sig);
    expect(guard.allows(sig)).toBe(false);
    expect(guard.allows(callSignature("read_file", { path: "b" }))).toBe(true);
    guard.recordSuccess(sig);
    expect(guard.allows(sig)).toBe(true);
  });
});

describe("planner", () => {
  it("classifies questions and tasks", () => {
    expect(classifyIntent("What does this project do?")).toBe("question");
    expect(classifyIntent("Where is the duty command registered")).toBe("question");
    expect(classifyIntent("Add a /health endpoint")).toBe("task");
    expect(classifyIntent("Can you fix the failing test?")).toBe("task");
  });

  it("selects tools by mode and intent", () => {
    const defs = (["READ", "SEARCH", "WRITE", "DELETE", "EXECUTE", "DEPENDENCY", "PROJECT"] as const).map(
      (category, i): ToolDefinition => ({ name: `t${i}_${category.toLowerCase()}`, description: "", inputSchema: {}, category, riskLevel: "safe" }),
    );
    expect(selectTools(defs, "ask", "task")).toEqual(["t0_read", "t1_search", "t6_project"]);
    expect(selectTools(defs, "agent", "question")).toEqual(["t0_read", "t1_search", "t4_execute", "t6_project"]);
    expect(selectTools(defs, "agent", "task")).toHaveLength(7);
  });

  it("maintains an editable plan", () => {
    let plan = applyPlanUpdate(undefined, [{ title: "Read" }, { title: "Edit", status: "in_progress" }]);
    expect(renderPlan(plan)).toContain("Edit");
    const editId = plan.steps[1]!.id;
    plan = editPlanStep(plan, editId, "Edit server.js");
    expect(plan.editedByUser).toBe(true);
    // Model updates keep the user's wording for unchanged positions.
    plan = removePlanStep(plan, plan.steps[0]!.id);
    expect(plan.steps.map((s) => s.title)).toEqual(["Edit server.js"]);
  });
});

describe("context manager", () => {
  const big = (n: number) => "x".repeat(n);

  it("keeps everything when it fits", () => {
    const built = buildContext({
      system: "sys",
      history: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }],
      request: "do it",
      taskTurns: [],
      budget: 8_192,
    });
    expect(built.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(built.omittedHistory).toBe(0);
  });

  it("compresses old tool results first and keeps the request and recent turns", () => {
    const taskTurns: ChatTurn[] = [];
    for (let i = 0; i < 10; i++) {
      taskTurns.push({ role: "assistant", content: "", tool_calls: [{ function: { name: "read_file", arguments: { path: `f${i}` } } }] });
      taskTurns.push({ role: "tool", content: `Read f${i}\n${big(4_000)}`, tool_name: "read_file" });
    }
    const built = buildContext({ system: "sys", history: [], request: "fix it", taskTurns, budget: 8_192 });
    expect(built.compressedToolResults).toBeGreaterThan(0);
    expect(built.messages.some((m) => m.role === "user" && m.content === "fix it")).toBe(true);
    expect(built.messages.at(-1)?.content.startsWith("Read f9")).toBe(true);
    expect(built.estimatedTokens).toBeLessThanOrEqual(8_192 - OUTPUT_RESERVE + 200);
    // Pairing preserved: every tool turn still follows its assistant call.
    expect(built.messages.filter((m) => m.role === "tool")).toHaveLength(10);
  });

  it("summarizes old history instead of dropping it silently", () => {
    const history: ChatTurn[] = [];
    for (let i = 0; i < 40; i++) {
      history.push({ role: "user", content: `question ${i} ${big(800)}` });
      history.push({ role: "assistant", content: big(800) });
    }
    const built = buildContext({ system: "sys", history, request: "now", taskTurns: [], budget: 4_096 });
    expect(built.omittedHistory).toBeGreaterThan(0);
    expect(built.messages[1]).toMatchObject({ role: "system", content: expect.stringContaining("condensed to save space") });
    expect(estimateMessages(built.messages)).toBeLessThan(4_096);
  });

  it("compresses a tool result but keeps its status line", () => {
    const out = compressToolResult(`Result: FAILED\n${big(2_000)}`, 100);
    expect(out.startsWith("Result: FAILED")).toBe(true);
    expect(out).toMatch(/compressed/);
  });

  it("resolves the context budget", () => {
    expect(resolveContextBudget(0, null)).toBe(8_192);
    expect(resolveContextBudget(0, 131_072)).toBe(16_384);
    expect(resolveContextBudget(32_768, 8_192)).toBe(8_192);
    expect(resolveContextBudget(4_096, 32_768)).toBe(4_096);
  });
});

describe("task memory", () => {
  it("dedupes and caps facts", () => {
    const m = new TaskMemory();
    m.add("Read a.ts.");
    m.add("Read a.ts.");
    for (let i = 0; i < MAX_FACTS + 5; i++) m.add(`fact ${i}`);
    expect(m.list()).toHaveLength(MAX_FACTS);
    expect(m.list().filter((f) => f === "Read a.ts.")).toHaveLength(0);
    expect(m.render()).toContain(`fact ${MAX_FACTS + 4}`);
  });
});

describe("verification engine", () => {
  let fakes: ReturnType<typeof installFakes>;
  beforeEach(() => {
    resetStores();
    fakes = installFakes();
    fakes.ws.files.clear();
  });
  const metadata = { packageManagers: [{ ecosystem: "node", manager: "pnpm", ambiguous: false }], frameworks: [], fivem: null } as never;
  const run = (exitCode: number) =>
    ({ outcome: { success: exitCode === 0, exitCode, cancelled: false, timedOut: false, durationMs: 1200, stdoutTail: "", stderrTail: exitCode ? "error TS2304" : "" } }) as unknown as RunResult;

  it("passes when files match and project checks pass", async () => {
    fakes.ws.files.set("package.json", JSON.stringify({ scripts: { typecheck: "tsc", lint: "eslint .", test: "vitest", build: "vite build" } }));
    fakes.ws.files.set("src/a.ts", "export const a = 1;\n");
    const ran: string[] = [];
    const engine = new VerificationEngine({
      services: getServices(),
      metadata: () => metadata,
      refreshMetadata: async () => metadata,
      runCheck: async (c) => {
        ran.push(c);
        return { result: run(0) };
      },
      signal: new AbortController().signal,
    });
    const result = await engine.verify([{ path: "src/a.ts", kind: "modify", expectedContent: "export const a = 1;\n" }]);
    expect(ran).toEqual(["pnpm run typecheck", "pnpm run lint", "pnpm test"]);
    expect(result.success).toBe(true);
    expect(result.checks).toHaveLength(4);
  });

  it("fails when a check fails or a file differs, and reports which", async () => {
    fakes.ws.files.set("package.json", JSON.stringify({ scripts: { typecheck: "tsc" } }));
    fakes.ws.files.set("src/a.ts", "changed later\n");
    const engine = new VerificationEngine({
      services: getServices(),
      metadata: () => metadata,
      refreshMetadata: async () => metadata,
      runCheck: async () => ({ result: run(2) }),
      signal: new AbortController().signal,
    });
    const result = await engine.verify([
      { path: "src/a.ts", kind: "modify", expectedContent: "export const a = 1;\n" },
      { path: "old.ts", kind: "delete" },
    ]);
    expect(result.success).toBe(false);
    expect(result.checks.find((c) => c.name === "pnpm run typecheck")).toMatchObject({ status: "failed", details: expect.stringContaining("TS2304") });
    expect(result.checks.find((c) => c.name.includes("has the written content"))?.status).toBe("failed");
    expect(result.checks.find((c) => c.name === "old.ts was deleted")?.status).toBe("passed");
    expect(result.summary).toMatch(/2 of 3 checks failed/);
  });

  it("chooses commands from what the project defines", async () => {
    fakes.ws.files.set("package.json", JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1', build: "vite build" } }));
    expect(await chooseCommands(getServices(), metadata)).toEqual(["pnpm run build"]);
    expect(await chooseCommands(getServices(), { packageManagers: [{ ecosystem: "rust" }], frameworks: [] } as never)).toEqual(["cargo check"]);
    expect(await chooseCommands(getServices(), null)).toEqual([]);
  });
});

describe("redaction and dragon mapping", () => {
  it("redacts secret keys and values", () => {
    expect(redact({ apiKey: "abc", path: "a.ts", nested: { password: "p" } })).toEqual({ apiKey: "[redacted]", path: "a.ts", nested: { password: "[redacted]" } });
    expect(redactText("token sk-abcdefghijklmnopqrstuv end")).toBe("token [redacted] end");
    expect(redactText("API_KEY=12345\nNAME=vinnie")).toBe("API_KEY=[redacted]\nNAME=vinnie");
    expect(redactText("ghp_abcdefghijklmnopqrstuvwxyz0123")).toBe("[redacted]");
  });

  it("maps agent events to dragon states", () => {
    const base = { taskId: "t", task: {} as never, label: "", at: 0 };
    expect(dragonStateFor({ ...base, type: "agent.thinking" })).toBe("thinking");
    expect(dragonStateFor({ ...base, type: "agent.tool_started", data: { category: "READ" } })).toBe("reading");
    expect(dragonStateFor({ ...base, type: "agent.tool_started", data: { category: "WRITE" } })).toBe("editing");
    expect(dragonStateFor({ ...base, type: "agent.tool_started", data: { category: "EXECUTE" } })).toBe("running");
    expect(dragonStateFor({ ...base, type: "agent.failed" })).toBe("error");
  });
});
