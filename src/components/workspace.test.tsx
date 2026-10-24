import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ApprovalCards } from "@/components/chat/ApprovalCard";
import { ChangesPanel } from "@/components/changes/ChangesPanel";
import { ExplorerPanel } from "@/components/explorer/ExplorerPanel";
import { gitMarks } from "@/components/explorer/gitMarks";
import { SearchPanel } from "@/components/search/SearchPanel";
import { TerminalPanel } from "@/components/terminal/TerminalPanel";
import type { ApprovalDecision } from "@/agent/types";
import { useApprovalStore } from "@/state/approvalStore";
import { useEditorStore } from "@/state/editorStore";
import { useProjectStore } from "@/state/projectStore";
import { useTerminalStore } from "@/state/terminalStore";
import { useWorkspaceStore } from "@/state/workspaceStore";
import { installFakes, resetStores } from "@/test/fakes";

let fakes: ReturnType<typeof installFakes>;
const project = { path: "C:\\Projects\\mystic-core", name: "mystic-core", status: "available" as const };

beforeEach(() => {
  resetStores();
  fakes = installFakes();
  fakes.ws.files.clear();
  fakes.ws.files.set("fxmanifest.lua", "fx_version 'cerulean'\n");
  fakes.ws.files.set("client/main.lua", "RegisterCommand('duty', function() end)\n");
  fakes.ws.files.set("server/main.lua", "RegisterCommand('pay', function() end)\n");
  fakes.ws.files.set("node_modules/x/index.js", "");
  useProjectStore.setState({ project });
  useWorkspaceStore.getState().reset(project.path);
});

describe("approval cards", () => {
  it("shows the exact command, workspace, and reason, and resolves with the user's choice", async () => {
    const user = userEvent.setup();
    const decision = useApprovalStore.getState().request({
      kind: "command",
      command: "npm install express",
      workspace: "C:\\Projects\\MyProject",
      cwd: null,
      reason: "Install the dependency required by the application.",
      assessment: {
        command: "npm install express",
        program: "npm",
        args: ["install", "express"],
        risk: "approval",
        installsDependencies: true,
        reason: "Changes the project's installed dependencies.",
      },
    });
    render(<ApprovalCards />);
    const card = screen.getByRole("alertdialog", { name: "Vinnie wants to run:" });
    expect(within(card).getByTestId("approval-command")).toHaveTextContent("npm install express");
    expect(card).toHaveTextContent("C:\\Projects\\MyProject");
    expect(card).toHaveTextContent("Install the dependency required by the application.");
    await user.click(within(card).getByRole("button", { name: "Always allow" }));
    const expected: ApprovalDecision = { approved: true, remember: true, manager: undefined };
    await expect(decision).resolves.toEqual(expected);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("shows a diff for file changes and can reject", async () => {
    const user = userEvent.setup();
    const decision = useApprovalStore.getState().request({
      kind: "file",
      operation: { kind: "write", path: "config.lua", content: "Config.Debug = true\n" },
      preview: {
        kind: "modify",
        path: "config.lua",
        newPath: null,
        before: "Config.Debug = false\n",
        after: "Config.Debug = true\n",
        diff: "",
        additions: 1,
        deletions: 1,
        binary: false,
      },
      reason: "Enable debug logging",
      workspace: project.path,
    });
    render(<ApprovalCards />);
    expect(screen.getByTestId("diff-original")).toHaveTextContent("Config.Debug = false");
    expect(screen.getByTestId("diff-modified")).toHaveTextContent("Config.Debug = true");
    await user.click(screen.getByRole("button", { name: "Reject" }));
    await expect(decision).resolves.toEqual({ approved: false });
  });
});

describe("explorer", () => {
  it("lazily lists folders, dims ignored ones, and opens files", async () => {
    const user = userEvent.setup();
    render(<ExplorerPanel />);
    const tree = await screen.findByRole("tree");
    await within(tree).findByText("fxmanifest.lua");
    expect(within(tree).queryByText("main.lua")).not.toBeInTheDocument();
    expect(within(tree).getByText("node_modules").closest("[role=treeitem]")).toHaveClass("opacity-50");

    await user.click(within(tree).getByText("client"));
    await user.click(await within(tree).findByText("main.lua"));
    await waitFor(() => expect(useEditorStore.getState().activeId).toBe("file:client/main.lua"));
  });

  it("asks for confirmation before deleting and records the change", async () => {
    const user = userEvent.setup();
    render(<ExplorerPanel />);
    await screen.findByText("fxmanifest.lua");
    await user.click(screen.getByRole("button", { name: "Delete fxmanifest.lua" }));
    const dialog = screen.getByRole("alertdialog");
    expect(fakes.ws.files.has("fxmanifest.lua")).toBe(true);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(fakes.ws.files.has("fxmanifest.lua")).toBe(false));
    expect(fakes.ws.changes[0]).toMatchObject({ kind: "delete", source: "user" });
  });

  it("computes git decorations for files and parent folders", () => {
    const marks = gitMarks(["client/main.lua"], ["docs/"]);
    expect(marks.modified.has("client/main.lua")).toBe(true);
    expect(marks.untracked.has("docs")).toBe(true);
    expect(marks.dirty.has("client")).toBe(true);
  });
});

describe("search panel", () => {
  it("searches as you type and opens the matching line", async () => {
    const user = userEvent.setup();
    render(<SearchPanel />);
    await user.type(screen.getByLabelText("Search query"), "RegisterCommand");
    const results = await screen.findByTestId("search-results");
    await within(results).findByText("RegisterCommand('duty', function() end)");
    expect(screen.getByText(/2 results in 2 files/)).toBeInTheDocument();
    await user.click(within(results).getByText("RegisterCommand('pay', function() end)"));
    await waitFor(() => expect(useEditorStore.getState().reveal).toMatchObject({ path: "server/main.lua", line: 1 }));
  });
});

describe("terminal panel", () => {
  it("runs typed commands and shows exit code and output", async () => {
    fakes.process.outcomes.set("npm test", { exitCode: 0, stdout: "added 42 packages\n", durationMs: 3400 });
    const user = userEvent.setup();
    render(<TerminalPanel />);
    await user.type(screen.getByLabelText("Terminal command"), "npm test{Enter}");
    const run = await screen.findByTestId("terminal-run");
    await within(run).findByText("added 42 packages");
    expect(run).toHaveTextContent("Code: 0");
    expect(run).toHaveTextContent("3.4s");
    expect(run).toHaveTextContent("Process exited with code 0");
  });

  it("explains failures and keeps raw output behind a toggle", async () => {
    fakes.process.outcomes.set("npm test", { exitCode: 1, stderr: "Error: Cannot find module 'express'\n" });
    await useTerminalStore.getState().run({ command: "npm test", actor: "user" });
    const user = userEvent.setup();
    render(<TerminalPanel />);
    const diagnosis = screen.getByTestId("diagnosis");
    expect(diagnosis).toHaveTextContent("Unable to run npm test");
    expect(diagnosis).toHaveTextContent("The command failed because: Cannot find module 'express'.");
    expect(diagnosis).toHaveTextContent("Suggested next step: Install the missing dependency");
    await user.click(within(diagnosis).getByRole("button", { name: /raw output/ }));
    expect(within(diagnosis).getByText(/Cannot find module 'express'$/m)).toBeInTheDocument();
  });

  it("shows why blocked commands did not run", async () => {
    fakes.process.requirements.set("del /q *", "blocked");
    const user = userEvent.setup();
    render(<TerminalPanel />);
    await user.type(screen.getByLabelText("Terminal command"), "del /q *{Enter}");
    expect(await screen.findAllByText(/Blocked by policy/)).not.toHaveLength(0);
    expect(fakes.process.runs).toHaveLength(0);
  });
});

describe("changes panel", () => {
  it("lists changes grouped by task and reverts them", async () => {
    const services = (await import("@/services")).getServices();
    await services.changes.apply(
      { kind: "write", path: "client/main.lua", content: "changed\n" },
      { access: { actor: "assistant", approved: true }, taskId: "t1", description: "Fix duty" },
    );
    await services.changes.apply(
      { kind: "create", path: "client/duty.lua", content: "x\n" },
      { access: { actor: "assistant", approved: true }, taskId: "t1", description: "Fix duty" },
    );
    const user = userEvent.setup();
    render(<ChangesPanel />);
    await screen.findByText("client/duty.lua");
    await user.click(screen.getByRole("button", { name: "Revert all (2)" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revert all" }));
    await waitFor(() => expect(fakes.ws.files.get("client/main.lua")).toBe("RegisterCommand('duty', function() end)\n"));
    expect(fakes.ws.files.has("client/duty.lua")).toBe(false);
    expect(await screen.findByText("Reverted 2 changes.")).toBeInTheDocument();
  });
});
