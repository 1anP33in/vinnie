import { getServices } from "@/services";
import { installFakes, resetStores } from "@/test/fakes";
import type { ManagerDetection, RunResult } from "@/lib/ipc/types";
import { createToolRegistry } from "../toolRegistry";
import { PermissionManager } from "../runtime/permissionManager";
import type { ApprovalDecision, ApprovalRequest, ToolContext, ToolRegistry } from "../types";
import { registerWorkspaceTools } from "./index";

let fakes: ReturnType<typeof installFakes>;
let registry: ToolRegistry;
let approvals: ApprovalRequest[];
let decision: ApprovalDecision;
let changed: string[];
let manager: PermissionManager;
let ask: (r: ApprovalRequest) => Promise<ApprovalDecision>;

function context(overrides: Partial<ToolContext> = {}): ToolContext {
  const ctx: ToolContext = {
    taskId: "task-1",
    signal: new AbortController().signal,
    services: getServices(),
    permissions: { read: "allowed", write: "approval", execute: "approval", installDependencies: "approval" },
    mode: "agent",
    workspaceRoot: "C:\\Projects\\demo",
    authorize: (request, capability) =>
      manager.authorize({
        request,
        capability,
        mode: ctx.mode,
        permissions: ctx.permissions,
        taskId: ctx.taskId,
        workspace: ctx.workspaceRoot,
        prompt: (r) => ask(r),
      }),
    runCommand: (r) =>
      getServices().process.run(
        { runId: "r1", command: r.command, actor: "assistant", approved: r.approved, remember: r.remember },
        () => {},
      ) as Promise<RunResult>,
    filesChanged: (paths) => changed.push(...paths),
    projectChanged: () => {},
    ...overrides,
  };
  return ctx;
}

beforeEach(() => {
  resetStores();
  fakes = installFakes();
  fakes.ws.files.clear();
  fakes.ws.files.set("fxmanifest.lua", "fx_version 'cerulean'\nclient_script 'client/main.lua'\n");
  fakes.ws.files.set("client/main.lua", "RegisterCommand('duty', function()\n  print('on duty')\nend)\n");
  fakes.ws.files.set(".env", "SECRET=1");
  registry = createToolRegistry();
  registerWorkspaceTools(registry);
  approvals = [];
  decision = { approved: true };
  changed = [];
  manager = new PermissionManager();
  ask = async (r) => {
    approvals.push(r);
    return decision;
  };
});

describe("workspace tools", () => {
  it("registers the workspace and agent tools", () => {
    expect(registry.list().map((t) => t.name)).toEqual([
      "get_project_structure",
      "search_files",
      "read_file",
      "create_file",
      "write_file",
      "delete_file",
      "move_file",
      "run_command",
      "install_dependency",
      "update_plan",
      "remember",
      "get_project_info",
    ]);
  });

  it("searches and reports path:line results", async () => {
    const r = await registry.execute("search_files", { query: "RegisterCommand" }, context());
    expect(r).toMatchObject({ success: true, summary: expect.stringContaining("client/main.lua:1: RegisterCommand('duty'") });
  });

  it("reads files with line numbers and windows", async () => {
    const r = await registry.execute("read_file", { path: "client/main.lua", startLine: 2, endLine: 3 }, context());
    expect(r.success && r.summary).toBe("client/main.lua (lines 2-3 of 4)\n2|   print('on duty')\n3| end)\n… 1 more lines (read with startLine=4).");
  });

  it("asks before reading files that may contain secrets", async () => {
    decision = { approved: false };
    const denied = await registry.execute("read_file", { path: ".env" }, context());
    expect(denied).toMatchObject({ success: false, outcome: "denied", error: { code: "PERMISSION_DENIED" } });
    expect(approvals[0]).toMatchObject({ kind: "read", path: ".env" });

    decision = { approved: true };
    const allowed = await registry.execute("read_file", { path: ".env" }, context());
    expect(allowed.success && allowed.summary).toContain("SECRET=1");
  });

  it("refuses paths outside the project", async () => {
    const r = await registry.execute("read_file", { path: "../../Windows/win.ini" }, context());
    expect(r).toMatchObject({ success: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("shows a diff for approval and applies the change only when approved", async () => {
    const content = "RegisterCommand('duty', function()\n  print('now on duty')\nend)\n";
    decision = { approved: false };
    const rejected = await registry.execute("write_file", { path: "client/main.lua", content, reason: "Fix message" }, context());
    expect(rejected).toMatchObject({ success: false, outcome: "denied", error: { code: "PERMISSION_DENIED" } });
    expect(fakes.ws.files.get("client/main.lua")).toContain("print('on duty')");
    const request = approvals[0];
    expect(request?.kind).toBe("file");
    if (request?.kind === "file") {
      expect(request.preview.before).toContain("print('on duty')");
      expect(request.preview.after).toBe(content);
      expect(request.reason).toBe("Fix message");
    }

    decision = { approved: true };
    const applied = await registry.execute("write_file", { path: "client/main.lua", content }, context());
    expect(applied.success && applied.summary).toMatch(/^Modified client\/main\.lua/);
    expect(fakes.ws.files.get("client/main.lua")).toBe(content);
    expect(fakes.ws.changes[0]).toMatchObject({ taskId: "task-1", source: "assistant" });
    expect(changed).toEqual(["client/main.lua"]);
  });

  it("writes without asking when WRITE is allowed, but deletions always ask", async () => {
    const permissions = { read: "allowed", write: "allowed", execute: "approval", installDependencies: "approval" } as const;
    await registry.execute("create_file", { path: "server/main.lua", content: "print(1)\n" }, context({ permissions }));
    expect(approvals).toHaveLength(0);
    expect(fakes.ws.files.get("server/main.lua")).toBe("print(1)\n");

    decision = { approved: false };
    const r = await registry.execute("delete_file", { path: "server/main.lua" }, context({ permissions }));
    expect(r).toMatchObject({ success: false, outcome: "denied", error: { code: "PERMISSION_DENIED" } });
    expect(approvals).toHaveLength(1);
    expect(fakes.ws.files.has("server/main.lua")).toBe(true);
  });

  it("respects a WRITE denial", async () => {
    const permissions = { read: "allowed", write: "denied", execute: "approval", installDependencies: "approval" } as const;
    const r = await registry.execute("create_file", { path: "x.lua", content: "" }, context({ permissions }));
    expect(r).toMatchObject({ success: false, outcome: "denied", error: { code: "PERMISSION_DENIED" } });
    expect(approvals).toHaveLength(0);
  });

  it("moves files", async () => {
    const r = await registry.execute("move_file", { from: "client/main.lua", to: "client/duty.lua" }, context());
    expect(r.success).toBe(true);
    expect(fakes.ws.files.has("client/duty.lua")).toBe(true);
    expect(changed).toEqual(["client/main.lua", "client/duty.lua"]);
  });

  it("runs low-risk commands without approval and reports exit codes", async () => {
    fakes.process.outcomes.set("npm test", { exitCode: 0, stdout: "3 passed\n" });
    const r = await registry.execute("run_command", { command: "npm test" }, context());
    expect(approvals).toHaveLength(0);
    expect(r.success && r.summary).toContain("Result: succeeded");
    expect(r.success && r.summary).toContain("Exit code: 0");
    expect(r.success && r.summary).toContain("3 passed");
  });

  it("asks before approval-required commands and honors denial", async () => {
    fakes.process.requirements.set("git checkout main", "approval");
    decision = { approved: false };
    const r = await registry.execute("run_command", { command: "git checkout main", reason: "Switch branch" }, context());
    expect(r).toMatchObject({ success: false, outcome: "denied", error: { code: "PERMISSION_DENIED" } });
    expect(approvals[0]).toMatchObject({ kind: "command", command: "git checkout main", reason: "Switch branch" });
    expect(fakes.process.runs).toHaveLength(0);
  });

  it("never runs blocked commands and never asks about them", async () => {
    fakes.process.requirements.set("del /q *", "blocked");
    const r = await registry.execute("run_command", { command: "del /q *" }, context());
    expect(r).toMatchObject({ success: false, error: { code: "PERMISSION_DENIED" } });
    expect(approvals).toHaveLength(0);
    expect(fakes.process.runs).toHaveLength(0);
  });

  it("reports failed commands honestly with a diagnosis", async () => {
    fakes.process.outcomes.set("npm test", { exitCode: 1, stderr: "Error: Cannot find module 'express'\n" });
    const r = await registry.execute("run_command", { command: "npm test" }, context());
    expect(r).toMatchObject({ success: false, error: { code: "COMMAND_FAILED" } });
    expect(r.summary).toContain("Result: FAILED");
    expect(r.summary).toContain("Likely cause: Cannot find module 'express'.");
  });

  it("installs with the detected package manager and reports failure truthfully", async () => {
    const detection: ManagerDetection = {
      ecosystem: "node",
      manager: "pnpm",
      candidates: ["pnpm"],
      ambiguous: false,
      reason: "Found the pnpm lockfile.",
      evidence: ["package.json", "pnpm-lock.yaml"],
    };
    fakes.analysis.state.detections = [detection];
    fakes.process.requirements.set("pnpm add zod", "approval");
    fakes.process.outcomes.set("pnpm add zod", { exitCode: 1, stderr: "ERR_PNPM_FETCH_404\n" });
    const r = await registry.execute("install_dependency", { packages: ["zod"], reason: "Validation" }, context());
    expect(approvals[0]).toMatchObject({ kind: "command", command: "pnpm add zod", install: { manager: "pnpm", packages: ["zod"] } });
    expect(r.success).toBe(false);
    expect(r.summary).toMatch(/^Installing zod FAILED/);
  });

  it("lets the user choose a manager when detection is ambiguous", async () => {
    fakes.analysis.state.detections = [
      { ecosystem: "node", manager: null, candidates: ["npm", "yarn"], ambiguous: true, reason: "Lockfiles for npm and yarn.", evidence: [] },
    ];
    fakes.process.requirements.set("npm install express", "approval");
    fakes.process.requirements.set("yarn add express", "approval");
    let calls = 0;
    const r = await registry.execute(
      "install_dependency",
      { packages: ["express"] },
      (() => {
        ask = async (req) => {
          approvals.push(req);
          calls++;
          return calls === 1 ? { approved: true, manager: "yarn" } : { approved: true };
        };
        return context();
      })(),
    );
    expect(approvals[0]).toMatchObject({ install: { ambiguous: true, candidates: ["npm", "yarn"] } });
    expect(fakes.process.runs.map((x) => x.command)).toEqual(["yarn add express"]);
    expect(r.success && r.summary).toMatch(/^Installed express successfully/);
  });
});
