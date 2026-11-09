// Agent runtime + MCP + skills, end to end: the same AgentRuntime loop runs
// MCP tools from a real MCP server (official SDK, in-memory transport).

import { waitFor } from "@testing-library/react";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NewMessage, RunResult } from "@/lib/ipc/types";
import { emptyServer } from "@/mcp/config";
import { McpManager } from "@/mcp/manager";
import { getServices } from "@/services";
import { useSettingsStore } from "@/state/settingsStore";
import { installFakes, resetStores, type FakeStream } from "@/test/fakes";
import { registerWorkspaceTools } from "../tools";
import type { ApprovalDecision, ApprovalRequest } from "../types";
import { PermissionManager } from "./permissionManager";
import { AgentRuntime, type RunSkill } from "./runtime";
import { DEFAULT_LIMITS } from "./types";

let fakes: ReturnType<typeof installFakes>;
let prompts: ApprovalRequest[];
let decide: (r: ApprovalRequest) => ApprovalDecision;
let persisted: NewMessage[];
let server: McpServer | null;
let manager: McpManager;
let listCalls: number;

function github(): McpServer {
  const s = new McpServer({ name: "fake-github", version: "1.0.0" });
  s.registerTool("list_issues", { description: "List open issues in a repository.", inputSchema: { repo: z.string() } }, async ({ repo }) => {
    listCalls++;
    return { content: [{ type: "text", text: `Open issues in ${repo}:\n#12 Login fails with 500 (bug)\n#15 Crash on empty cart (bug)\n#16 Add dark mode (feature)` }] };
  });
  s.registerTool("create_issue", { description: "Create an issue.", inputSchema: { repo: z.string(), title: z.string() } }, async () => ({ content: [{ type: "text", text: "created" }] }));
  server = s;
  return s;
}

beforeEach(async () => {
  resetStores();
  fakes = installFakes();
  registerWorkspaceTools(getServices().tools);
  prompts = [];
  persisted = [];
  listCalls = 0;
  decide = () => ({ approved: true });
  manager = new McpManager({
    mcp: () => getServices().mcp,
    registry: () => getServices().tools,
    policyFor: (c) => c.defaultPolicy,
    pingIntervalMs: 0,
    reconnectDelaysMs: [],
    createTransport: () => {
      const [a, b] = InMemoryTransport.createLinkedPair();
      void github().connect(b);
      return a;
    },
  });
  await manager.save({ ...emptyServer(), id: "github", name: "GitHub" }, {}, true);
  await waitFor(() => expect(manager.get("github")?.status).toBe("connected"));
});

afterEach(() => manager.shutdown());

function runtime(request: string, skills: RunSkill[] = [], workspaceRoot: string | null = "C:\\Projects\\demo") {
  return new AgentRuntime(
    {
      provider: fakes.provider,
      registry: getServices().tools,
      services: getServices(),
      permissions: new PermissionManager(),
      settings: () => useSettingsStore.getState().settings,
      prompt: async (r) => {
        prompts.push(r);
        return decide(r);
      },
      runCommand: async () => ({}) as RunResult,
      stopCommands: () => {},
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
      notice: () => {},
      sleep: async () => {},
    },
    {
      conversationId: "c1",
      request,
      model: "qwen3:8b",
      history: [],
      project: null,
      workspaceRoot,
      mode: "agent",
      limits: { ...DEFAULT_LIMITS },
      autoVerify: true,
      toolsEnabled: true,
      skills,
    },
  );
}

async function stream(n: number): Promise<FakeStream> {
  await waitFor(() => expect(fakes.provider.streams).toHaveLength(n));
  return fakes.provider.lastStream();
}

const toolNames = (s: FakeStream) => (s.tools ?? []).map((t) => (t as { function: { name: string } }).function.name);

describe("agent runtime with MCP tools", () => {
  it("offers MCP tools without a project folder, but no project tools", async () => {
    const rt = runtime("Use the GitHub server to list the issues in me/app", [], null);
    const done = rt.run();
    const s1 = await stream(1);
    const names = toolNames(s1);
    expect(names).toContain("github__list_issues");
    expect(names).not.toContain("read_file");
    expect(names).not.toContain("run_command");
    s1.emit({ type: "content", text: "ok" });
    s1.complete();
    await done;
  });

  it("finds and summarizes GitHub issues through an MCP tool, with approval", async () => {
    const rt = runtime("Find the issues in my GitHub repository me/app and summarize the open bugs.");
    const done = rt.run();
    const s1 = await stream(1);
    expect(toolNames(s1)).toContain("github__list_issues");
    expect(toolNames(s1)).not.toContain("github__create_issue"); // a question only gets read tools
    expect(s1.messages[0]?.content).toContain("External tools:");
    s1.callTool("github__list_issues", { repo: "me/app" });
    s1.complete();

    const s2 = await stream(2);
    expect(prompts).toEqual([expect.objectContaining({ kind: "mcp", tool: "list_issues", arguments: { repo: "me/app" } })]);
    expect(s2.messages.at(-1)).toMatchObject({ role: "tool", tool_name: "github__list_issues", content: expect.stringContaining("#12 Login fails") });
    s2.emit({ type: "content", text: "Two open bugs: #12 (login 500) and #15 (empty cart crash)." });
    s2.complete();

    const task = await done;
    expect(task.status).toBe("completed");
    expect(listCalls).toBe(1);
    expect(task.steps.some((s) => s.tool?.name === "github__list_issues" && s.status === "succeeded")).toBe(true);
    expect(persisted.at(-1)?.content).toContain("Task report");
  });

  it("a denied MCP call is reported to the model and never reaches the server", async () => {
    decide = () => ({ approved: false });
    const rt = runtime("Find the issues in my GitHub repository me/app.");
    const done = rt.run();
    const s1 = await stream(1);
    s1.callTool("github__list_issues", { repo: "me/app" });
    s1.complete();
    const s2 = await stream(2);
    expect(s2.messages.at(-1)?.content).toMatch(/denied/i);
    s2.emit({ type: "content", text: "You declined, so I can't list them." });
    s2.complete();
    await done;
    expect(listCalls).toBe(0);
  });

  it("keeps going when the MCP server disconnects mid-task", async () => {
    const rt = runtime("Find the issues in my GitHub repository me/app.");
    const done = rt.run();
    const s1 = await stream(1);
    await server!.close();
    await waitFor(() => expect(manager.get("github")?.status).not.toBe("connected"));
    s1.callTool("github__list_issues", { repo: "me/app" });
    s1.complete();
    const s2 = await stream(2);
    expect(s2.messages.at(-1)?.content).toMatch(/not connected|unavailable/);
    expect(toolNames(s2)).not.toContain("github__list_issues"); // no longer offered
    s2.emit({ type: "content", text: "GitHub is disconnected." });
    s2.complete();
    expect((await done).status).toBe("completed");
  });

  it("uses skill instructions as guidance and records them on the task", async () => {
    const skills: RunSkill[] = [
      { id: "git-assistance", name: "Git Assistance", instructions: "Never force-push. Use the GitHub tools for issues.", references: [], tools: ["github.*"], reasons: ['mentions "github"'], manual: false },
    ];
    const rt = runtime("Look at the issues on GitHub for me/app", skills);
    const done = rt.run();
    const s1 = await stream(1);
    expect(s1.messages[0]?.content).toContain("Active skills");
    expect(s1.messages[0]?.content).toContain("Never force-push.");
    expect(toolNames(s1)).not.toContain("read_skill_reference"); // the skill has no references
    s1.emit({ type: "content", text: "ok" });
    s1.complete();
    const task = await done;
    expect(task.skills).toEqual([{ id: "git-assistance", name: "Git Assistance", reasons: ['mentions "github"'], manual: false }]);
    expect(task.steps[0]?.title).toBe("Using skills: Git Assistance");
  });
});
