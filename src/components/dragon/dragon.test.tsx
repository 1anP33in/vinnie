import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emitAgentEvent, type AgentEvent } from "@/agent/runtime/events";
import type { AgentTask } from "@/agent/runtime/types";
import { Workbench } from "@/components/layout/Workbench";
import { useCompanionStore } from "@/dragon/companionStore";
import { connectDragonToAgent, disconnectDragonFromAgent } from "@/dragon/eventAdapter";
import { getServices } from "@/services";
import { useSettingsStore } from "@/state/settingsStore";
import { installFakes, resetStores } from "@/test/fakes";
import { DragonPanel } from "./DragonPanel";

// three.js needs WebGL; the viewer is replaced so the panel can be tested.
vi.mock("./DragonViewer", () => ({
  default: (props: { behavior: string; config: { quality: string } }) => (
    <div data-testid="viewer-mock" data-behavior={props.behavior} data-quality={props.config.quality} />
  ),
}));

beforeEach(() => {
  resetStores();
  installFakes();
  connectDragonToAgent();
});
afterEach(() => disconnectDragonFromAgent());

function setDragon(patch: Partial<ReturnType<typeof useSettingsStore.getState>["settings"]["dragon"]>) {
  const s = useSettingsStore.getState().settings;
  useSettingsStore.setState({ settings: { ...s, dragon: { ...s.dragon, ...patch } } });
}

function agentEvent(type: AgentEvent["type"], status: AgentTask["status"], label: string, data?: Record<string, unknown>): AgentEvent {
  return {
    type,
    taskId: "t1",
    at: Date.now(),
    label,
    data,
    task: {
      id: "t1",
      conversationId: "c1",
      userRequest: "Run the tests",
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
    },
  };
}

describe("DragonPanel", () => {
  it("shows the runtime's task, activity, tool, and state", async () => {
    render(<DragonPanel layout="side" />);
    expect(await screen.findByTestId("viewer-mock")).toHaveAttribute("data-behavior", "idle");
    expect(screen.getByText("No task running")).toBeInTheDocument();

    emitAgentEvent(agentEvent("agent.started", "thinking", "Task started"));
    emitAgentEvent(agentEvent("agent.tool_started", "executing", "Running npm test", { tool: "run_command", category: "EXECUTE" }));

    const activity = await screen.findByTestId("dragon-activity");
    await waitFor(() => expect(within(activity).getByTestId("dragon-state")).toHaveTextContent("Executing"));
    expect(within(activity).getByText("Run the tests")).toBeInTheDocument();
    expect(within(activity).getAllByText("Running npm test").length).toBeGreaterThan(0);
    expect(within(activity).getByText("run_command")).toBeInTheDocument();
    expect(within(activity).getByText("Running a command")).toBeInTheDocument();
    expect(screen.getByTestId("viewer-mock")).toHaveAttribute("data-behavior", "executing");
  });

  it("viewer controls change and persist the settings", async () => {
    const user = userEvent.setup();
    render(<DragonPanel layout="side" />);
    await user.click(screen.getByRole("button", { name: "Viewer settings" }));
    const controls = screen.getByTestId("dragon-controls");
    await user.click(within(controls).getByRole("radio", { name: "High" }));
    await user.click(within(controls).getByRole("switch", { name: "Snow" }));
    await user.click(screen.getByRole("button", { name: "Pause idle animations" }));
    await user.click(within(controls).getByRole("button", { name: "Zoom in" }));

    const d = useSettingsStore.getState().settings.dragon;
    expect(d).toMatchObject({ quality: "high", snow: false, idleAnimations: false });
    expect(d.camera.distancePct).toBe(85);
    expect(screen.getByTestId("viewer-mock")).toHaveAttribute("data-quality", "high");
    // Saved through the existing settings service (debounced).
    await waitFor(async () => expect((await getServices().settings.load()).dragon).toMatchObject({ quality: "high", snow: false }), {
      timeout: 2000,
    });

    await user.click(screen.getAllByRole("button", { name: "Reset camera" })[0]!);
    expect(useSettingsStore.getState().settings.dragon.camera).toEqual({ azimuthDeg: 28, elevationDeg: 14, distancePct: 100 });
  });

  it("goes full screen and back with Escape", async () => {
    const user = userEvent.setup();
    render(<DragonPanel layout="side" />);
    await user.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByTestId("dragon-panel").className).toContain("fixed");
    await user.keyboard("{Escape}");
    expect(screen.getByTestId("dragon-panel").className).not.toContain("fixed");
  });
});

describe("Workbench with the dragon", () => {
  it("shows the panel beside the chat, and hides it", async () => {
    const user = userEvent.setup();
    setDragon({ enabled: true, panelOpen: true, layout: "side" });
    render(<Workbench />);
    expect(screen.getByTestId("dragon-panel")).toHaveAttribute("data-layout", "side");
    await user.click(screen.getByRole("button", { name: "Hide the dragon" }));
    expect(screen.queryByTestId("dragon-panel")).not.toBeInTheDocument();
    expect(useSettingsStore.getState().settings.dragon.panelOpen).toBe(false);
  });

  it("disabled: no dragon at all, the chat still renders", () => {
    setDragon({ enabled: false });
    render(<Workbench />);
    expect(screen.queryByTestId("dragon-panel")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox")).toBeInTheDocument();
  });

  it("compact layout sits above the chat", () => {
    setDragon({ enabled: true, panelOpen: true, layout: "compact" });
    render(<Workbench />);
    expect(screen.getByTestId("dragon-panel")).toHaveAttribute("data-layout", "compact");
  });

  it("keeps the store connected even when no panel is shown", () => {
    setDragon({ enabled: false });
    render(<Workbench />);
    emitAgentEvent(agentEvent("agent.started", "thinking", "Task started"));
    expect(useCompanionStore.getState().behavior).toBe("thinking");
  });
});
