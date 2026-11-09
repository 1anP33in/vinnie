import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentTask } from "@/agent/runtime/types";
import { LaunchOllamaButton } from "@/components/common/LaunchOllamaButton";
import { SettingsView } from "@/components/settings/SettingsView";
import { VinnieError } from "@/lib/errors";
import { useAgentStore } from "@/state/agentStore";
import { useConnectionStore } from "@/state/connectionStore";
import { useConversationStore } from "@/state/conversationStore";
import { useSettingsStore } from "@/state/settingsStore";
import { installFakes, resetStores } from "@/test/fakes";
import { AgentPanel } from "./AgentPanel";
import { TaskPanel } from "./TaskPanel";

let fakes: ReturnType<typeof installFakes>;

beforeEach(async () => {
  resetStores();
  fakes = installFakes();
  await useSettingsStore.getState().load();
});

function task(over: Partial<AgentTask> = {}): AgentTask {
  return {
    id: "task-1",
    conversationId: "conv-1",
    userRequest: "Add a /health endpoint",
    model: "qwen3:8b",
    mode: "agent",
    intent: "task",
    status: "executing",
    plan: {
      steps: [
        { id: "p1", title: "Inspect server.js", status: "done" },
        { id: "p2", title: "Add the route", status: "in_progress" },
        { id: "p3", title: "Run tests", status: "pending" },
      ],
      editedByUser: false,
      updatedAt: 0,
    },
    steps: [
      { id: "s1", kind: "tool", title: "Reading server.js", status: "succeeded", startedAt: 1_000, endedAt: 1_200, tool: { name: "read_file", arguments: { path: "server.js" } } },
      {
        id: "s2",
        kind: "tool",
        title: "Editing server.js",
        status: "running",
        startedAt: 1_300,
        tool: { name: "write_file", arguments: { path: "server.js", apiKey: "sk-secretsecretsecretsecret" } },
      },
    ],
    memory: ["Read server.js."],
    changes: [],
    startedAt: Date.now() - 5_000,
    iteration: 2,
    toolCalls: 2,
    retries: 0,
    usage: { promptTokens: 1200, completionTokens: 300, contextBudget: 8192, peakPromptTokens: 900 },
    ...over,
  } as AgentTask;
}

function show(t: AgentTask) {
  useConversationStore.setState({ activeId: t.conversationId });
  useAgentStore.setState({ tasks: { [t.id]: t }, order: [t.id], activeTaskId: t.status === "completed" ? null : t.id });
}

describe("agent panel", () => {
  it("shows live status, the plan, stats, and controls", async () => {
    show(task());
    render(<AgentPanel />);
    expect(screen.getByTestId("agent-status")).toHaveTextContent("Vinnie is preparing changes…");
    expect(screen.getByTestId("agent-current-step")).toHaveTextContent("Editing server.js");
    const plan = screen.getByTestId("agent-plan");
    expect(within(plan).getAllByRole("listitem").map((li) => li.dataset.status)).toEqual(["done", "in_progress", "pending"]);
    expect(screen.getByTestId("agent-stats")).toHaveTextContent("2 tool calls");
    expect(screen.getByRole("button", { name: "Pause" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument();
  });

  it("lets the user edit a plan step", async () => {
    const user = userEvent.setup();
    const edit = vi.fn();
    show(task());
    useAgentStore.setState({ editPlanStep: edit });
    render(<AgentPanel />);
    await user.click(screen.getByRole("button", { name: "Edit step: Run tests" }));
    const input = screen.getByRole("textbox", { name: "Plan step" });
    await user.clear(input);
    await user.type(input, "Run npm test{Enter}");
    expect(edit).toHaveBeenCalledWith("p3", "Run npm test");
  });

  it("shows the outcome with verification, changed files, and revert/accept", async () => {
    const user = userEvent.setup();
    const revertTask = vi.fn(async () => "Reverted 1 file.");
    show(
      task({
        status: "completed",
        completedAt: Date.now(),
        changes: [{ path: "server.js", kind: "modify", changeId: 7 }],
        result: {
          status: "completed",
          reason: "Changes made and verified.",
          verification: {
            success: true,
            summary: "All 2 checks passed.",
            checks: [
              { id: "c1", name: "server.js exists", kind: "file", status: "passed", details: "" },
              { id: "c2", name: "npm test", kind: "command", status: "passed", details: "Exit code 0" },
            ],
          },
          changes: { files: 1, additions: 4, deletions: 0, paths: ["server.js"] },
        },
      }),
    );
    useAgentStore.setState({ revertTask });
    render(<AgentPanel />);
    expect(screen.getByTestId("agent-status")).toHaveTextContent("Task completed");
    expect(screen.getByTestId("verification-checks")).toHaveTextContent("npm test");
    expect(screen.queryByRole("button", { name: "Pause" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revert task" }));
    expect(revertTask).toHaveBeenCalledWith("task-1");
    expect(await screen.findByText("Reverted 1 file.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Accept changes" })).toBeInTheDocument();
  });

  it("is hidden for simple answered questions", () => {
    show(task({ intent: "question", status: "completed", plan: undefined, result: { status: "completed", reason: "Answered.", verification: null, changes: { files: 0, additions: 0, deletions: 0, paths: [] } } }));
    render(<AgentPanel />);
    expect(screen.queryByTestId("agent-panel")).not.toBeInTheDocument();
  });

  it("shows failures honestly", () => {
    show(
      task({
        status: "failed",
        completedAt: Date.now(),
        result: { status: "failed", reason: "Verification still failed after 3 attempt(s).", verification: null, changes: { files: 0, additions: 0, deletions: 0, paths: [] } },
      }),
    );
    render(<AgentPanel />);
    expect(screen.getByTestId("agent-status")).toHaveTextContent("Task failed");
    expect(screen.getByText(/Verification still failed/)).toBeInTheDocument();
  });
});

describe("task panel", () => {
  it("shows the timeline, and a redacted debug view when enabled", async () => {
    const user = userEvent.setup();
    const settings = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...settings, agent: { ...settings.agent, debugView: true } } });
    show(task());
    render(<TaskPanel />);
    expect(screen.getByTestId("task-timeline")).toHaveTextContent("Reading server.js");
    await user.click(screen.getByRole("checkbox", { name: "Debug view" }));
    const debug = screen.getByTestId("task-debug");
    expect(debug).toHaveTextContent("task-1");
    expect(debug).toHaveTextContent("[redacted]");
    expect(debug).not.toHaveTextContent("sk-secret");
  });
});

describe("launch Ollama button", () => {
  it("starts Ollama and reconnects", async () => {
    const user = userEvent.setup();
    fakes.provider.connectionError = new VinnieError("unreachable", "Can't reach Ollama.");
    await useConnectionStore.getState().refresh();
    expect(useConnectionStore.getState().status).not.toBe("connected");
    const launch = vi.spyOn(fakes.system, "launchOllama").mockImplementation(async () => {
      fakes.provider.connectionError = null;
      return { status: "started", executable: "C:\\Ollama\\ollama.exe" };
    });
    render(<LaunchOllamaButton />);
    await user.click(screen.getByRole("button", { name: /Launch Ollama/ }));
    expect(launch).toHaveBeenCalled();
    await waitFor(() => expect(useConnectionStore.getState().status).toBe("connected"));
  });

  it("explains when Ollama is not installed", async () => {
    const user = userEvent.setup();
    vi.spyOn(fakes.system, "launchOllama").mockRejectedValue(
      new VinnieError("not_found", "Ollama isn't installed. Download it from https://ollama.com/download."),
    );
    render(<LaunchOllamaButton />);
    await user.click(screen.getByRole("button", { name: /Launch Ollama/ }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
  });
});

describe("agent settings", () => {
  it("edits and saves agent settings, with Full Auto shown as unavailable", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    expect(screen.getByText(/Full Auto — coming later/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Assist" }));
    await user.click(screen.getByRole("radio", { name: "16K" }));
    const iterations = screen.getByLabelText("Max iterations");
    await user.clear(iterations);
    await user.type(iterations, "40");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
    expect(useSettingsStore.getState().settings.agent).toMatchObject({ mode: "assist", contextBudget: 16384, maxIterations: 40 });
  });

  it("rejects out-of-range limits", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const retries = screen.getByLabelText("Max retries");
    await user.clear(retries);
    await user.type(retries, "99");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/Maximum retries must be between 0 and 10/, { selector: "[role=alert]" })).toBeInTheDocument();
  });
});

