import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { registerWorkspaceTools } from "@/agent/tools";
import type { ApprovalDecision } from "@/agent/types";
import { ApprovalCards } from "@/components/chat/ApprovalCard";
import { emptyServer } from "@/mcp/config";
import { McpManager } from "@/mcp/manager";
import { getServices, setServices } from "@/services";
import { useApprovalStore } from "@/state/approvalStore";
import { getMcpManager, resetMcpManager } from "@/state/mcpStore";
import { useSkillStore } from "@/state/skillStore";
import { useToolSettingsStore } from "@/state/toolSettingsStore";
import { installFakes, resetStores } from "@/test/fakes";
import { createFakeSkills, skillMeta } from "@/test/integrationFakes";
import { McpView } from "./McpView";
import { SkillsView } from "./SkillsView";
import { ToolsView } from "./ToolsView";

let fakes: ReturnType<typeof installFakes>;

function useTestManager() {
  const manager = new McpManager({
    mcp: () => getServices().mcp,
    registry: () => getServices().tools,
    policyFor: (c, t) => useToolSettingsStore.getState().policyFor(c, t),
    pingIntervalMs: 0,
    reconnectDelaysMs: [],
    createTransport: () => {
      const s = new McpServer({ name: "fake-github", version: "2.0.0" });
      s.registerTool("list_issues", { description: "List issues.", inputSchema: { repo: z.string() } }, async () => ({ content: [{ type: "text", text: "none" }] }));
      s.registerTool("delete_repo", { description: "Delete a repository.", inputSchema: { repo: z.string() } }, async () => ({ content: [{ type: "text", text: "gone" }] }));
      const [a, b] = InMemoryTransport.createLinkedPair();
      void s.connect(b);
      return a;
    },
  });
  resetMcpManager(manager);
  return manager;
}

beforeEach(async () => {
  resetStores();
  fakes = installFakes();
  registerWorkspaceTools(getServices().tools);
  await useToolSettingsStore.getState().load();
});

describe("MCP manager screen", () => {
  it("adds a server with a secret, connects, and lists its tools", async () => {
    const user = userEvent.setup();
    useTestManager();
    render(<McpView />);
    expect(screen.getByText(/No MCP servers yet/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add MCP server" }));
    const editor = screen.getByTestId("server-editor");
    await user.type(within(editor).getByLabelText("Name"), "GitHub");
    expect(within(editor).getByLabelText("ID (tool prefix)")).toHaveValue("github");
    await user.type(within(editor).getByLabelText("Secret name"), "GITHUB_TOKEN");
    await user.type(within(editor).getByLabelText("Secret value"), "ghp_secret123");
    await user.click(within(editor).getByRole("button", { name: "Add secret" }));
    expect(within(editor).getByText("env:GITHUB_TOKEN")).toBeInTheDocument();
    await user.click(within(editor).getByRole("button", { name: "Add server" }));

    const details = await screen.findByTestId("server-details");
    await waitFor(() => expect(within(details).getByTestId("server-status")).toHaveTextContent("CONNECTED"));
    expect(fakes.mcp.secrets.get("github/env:GITHUB_TOKEN")).toBe("ghp_secret123");
    expect(JSON.stringify(fakes.mcp.servers.get("github"))).not.toContain("ghp_secret123");
    const tools = within(details).getByTestId("server-tools");
    expect(tools).toHaveTextContent("list_issues");
    expect(tools).toHaveTextContent("Delete");
    expect(screen.getByRole("list", { name: "MCP servers" })).toHaveTextContent("2 tools available");
  });

  it("validates the editor before saving", async () => {
    const user = userEvent.setup();
    useTestManager();
    render(<McpView />);
    await user.click(screen.getByRole("button", { name: "Add MCP server" }));
    const editor = screen.getByTestId("server-editor");
    await user.click(within(editor).getByRole("radio", { name: /Remote/ }));
    await user.type(within(editor).getByLabelText("Name"), "Remote");
    await user.type(within(editor).getByLabelText("URL"), "http://example.com/mcp");
    await user.click(within(editor).getByRole("button", { name: "Add server" }));
    expect(await within(editor).findByText(/Remote servers must use https/)).toBeInTheDocument();
    expect(fakes.mcp.servers.size).toBe(0);
  });

  it("disconnects, disables a tool, and removes the server", async () => {
    const user = userEvent.setup();
    const manager = useTestManager();
    await manager.save({ ...emptyServer(), id: "github", name: "GitHub" }, {}, true);
    render(<McpView />);
    const details = await screen.findByTestId("server-details");
    await waitFor(() => expect(within(details).getByTestId("server-status")).toHaveTextContent("CONNECTED"));
    await user.click(within(details).getByRole("switch", { name: "Enable github.list_issues" }));
    expect(useToolSettingsStore.getState().isEnabled("mcp:github:list_issues")).toBe(false);
    expect(getServices().tools.isEnabled("github__list_issues")).toBe(false);
    await user.click(within(details).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(within(details).getByTestId("server-status")).toHaveTextContent("DISCONNECTED"));
    await user.click(within(details).getByRole("button", { name: "Remove" }));
    await user.click(screen.getByRole("button", { name: "Remove server" }));
    await waitFor(() => expect(screen.getByText(/No MCP servers yet/)).toBeInTheDocument());
  });

  it("exports configurations without secrets", async () => {
    const user = userEvent.setup();
    const manager = useTestManager();
    await manager.save({ ...emptyServer(), id: "github", name: "GitHub", autoConnect: false }, { "env:GITHUB_TOKEN": "ghp_secret" }, true);
    render(<McpView />);
    await user.click(screen.getByRole("button", { name: "Export" }));
    const saved = fakes.dialogs.saved[0]!.content;
    expect(saved).toContain("env:GITHUB_TOKEN");
    expect(saved).not.toContain("ghp_secret");
  });
});

describe("tool explorer", () => {
  it("lists native and MCP tools and disables them", async () => {
    const user = userEvent.setup();
    const manager = useTestManager();
    await manager.save({ ...emptyServer(), id: "github", name: "GitHub" }, {}, true);
    await waitFor(() => expect(manager.get("github")?.status).toBe("connected"));
    render(<ToolsView />);
    const table = screen.getByTestId("tools-table");
    expect(table).toHaveTextContent("read_file");
    expect(table).toHaveTextContent("github.list_issues");
    await user.click(screen.getByRole("tab", { name: "MCP tools" }));
    expect(screen.getByTestId("tools-table")).not.toHaveTextContent("read_file");
    await user.type(screen.getByLabelText("Search tools"), "delete");
    expect(screen.getByTestId("tools-table")).toHaveTextContent("github.delete_repo");
    expect(screen.getByTestId("tools-table")).not.toHaveTextContent("github.list_issues");
    await user.click(screen.getByRole("switch", { name: "Enable github.delete_repo" }));
    expect(getServices().tools.isEnabled("github__delete_repo")).toBe(false);
    expect(fakes.toolSettings.settings.get("mcp:github:delete_repo")?.enabled).toBe(false);
  });
});

describe("skills screen", () => {
  beforeEach(() => {
    const skills = createFakeSkills([{ meta: skillMeta("git-assistance", { name: "Git Assistance" }), instructions: "Never force-push." }]);
    setServices({ skills: skills.service });
  });

  it("creates a custom skill", async () => {
    const user = userEvent.setup();
    render(<SkillsView />);
    await screen.findByText("Git Assistance");
    await user.click(screen.getByRole("button", { name: "Create skill" }));
    const editor = screen.getByTestId("skill-editor");
    await user.type(within(editor).getByLabelText("Name"), "Duty System");
    await user.type(within(editor).getByLabelText("Description"), "Helps build FiveM duty systems.");
    await user.type(within(editor).getByLabelText("Use when the request mentions"), "duty, on duty");
    await user.type(within(editor).getByLabelText("Instructions"), "Store shifts with oxmysql.");
    await user.click(within(editor).getByRole("button", { name: "Create skill" }));
    await waitFor(() => expect(useSkillStore.getState().skills.find((s) => s.id === "duty-system")?.match.keywords).toEqual(["duty", "on duty"]));
  });

  it("disables a skill and turns one on for the session", async () => {
    const user = userEvent.setup();
    render(<SkillsView />);
    await user.click(await screen.findByRole("switch", { name: "Disable Git Assistance" }));
    await waitFor(() => expect(useSkillStore.getState().skills[0]?.enabled).toBe(false));
    await user.click(screen.getByText("Git Assistance"));
    await user.click(within(await screen.findByRole("radiogroup", { name: "Use in this session" })).getByRole("radio", { name: "On" }));
    expect(useSkillStore.getState().overrides["git-assistance"]).toBe("on");
  });
});

describe("MCP approval card", () => {
  it("shows the server, real tool name, and redacted arguments; destructive needs confirmation", async () => {
    const user = userEvent.setup();
    const decision: Promise<ApprovalDecision> = useApprovalStore.getState().request({
      kind: "mcp",
      server: { id: "github", name: "GitHub" },
      tool: "delete_repo",
      arguments: { repo: "me/app", token: "ghp_abcdefghijklmnopqrstuvwxyz" },
      permission: "DELETE",
      destructive: true,
      policy: "ask",
      reason: null,
      workspace: "C:\\p",
    });
    render(<ApprovalCards />);
    const card = screen.getByRole("alertdialog", { name: "Vinnie wants to use GitHub:" });
    expect(within(card).getByTestId("approval-tool")).toHaveTextContent("delete_repo");
    expect(card).toHaveTextContent("me/app");
    expect(card).not.toHaveTextContent("ghp_abc");
    expect(card).toHaveTextContent("[redacted]");
    expect(within(card).queryByRole("button", { name: "Allow for session" })).not.toBeInTheDocument();
    const allow = within(card).getByRole("button", { name: "Allow once" });
    expect(allow).toBeDisabled();
    await user.click(within(card).getByRole("checkbox"));
    await user.click(allow);
    await expect(decision).resolves.toMatchObject({ approved: true, scope: "once" });
  });

  it("offers session approval for non-destructive tools", async () => {
    const user = userEvent.setup();
    const decision = useApprovalStore.getState().request({
      kind: "mcp",
      server: { id: "github", name: "GitHub" },
      tool: "create_issue",
      arguments: { repo: "me/app", title: "Fix authentication bug" },
      permission: "WRITE",
      destructive: false,
      policy: "ask",
      reason: null,
      workspace: "C:\\p",
    });
    render(<ApprovalCards />);
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Fix authentication bug");
    await user.click(screen.getByRole("button", { name: "Allow for session" }));
    await expect(decision).resolves.toMatchObject({ approved: true, scope: "session" });
  });
});

afterAll(() => {
  void getMcpManager().shutdown();
});
