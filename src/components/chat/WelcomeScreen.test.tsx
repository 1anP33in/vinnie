import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VinnieError } from "@/lib/errors";
import { useConnectionStore } from "@/state/connectionStore";
import { useSettingsStore } from "@/state/settingsStore";
import { useUiStore } from "@/state/uiStore";
import { installFakes, model, resetStores } from "@/test/fakes";
import { EXAMPLE_PULL_COMMAND } from "./NoModelsNotice";
import { WelcomeScreen } from "./WelcomeScreen";

beforeEach(() => {
  resetStores();
  installFakes();
});

describe("WelcomeScreen", () => {
  it("explains how to fix an unreachable Ollama", () => {
    useConnectionStore.setState({
      status: "disconnected",
      error: new VinnieError("unreachable", "Could not connect to Ollama at http://localhost:11434."),
    });
    render(<WelcomeScreen />);
    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach Ollama");
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByText("ollama serve")).toBeInTheDocument();
  });

  it("shows install guidance when no models are installed", () => {
    useConnectionStore.setState({ status: "connected", modelsStatus: "loaded", models: [] });
    render(<WelcomeScreen />);
    expect(screen.getByText("No models installed")).toBeInTheDocument();
    expect(screen.getByText(EXAMPLE_PULL_COMMAND)).toBeInTheDocument();
    expect(screen.getByText(/never downloads models/i)).toBeInTheDocument();
  });

  it("offers suggestions that fill the composer when ready", async () => {
    useConnectionStore.setState({
      status: "connected",
      modelsStatus: "loaded",
      models: [model("qwen3:8b")],
      selectedModel: "qwen3:8b",
    });
    const user = userEvent.setup();
    render(<WelcomeScreen />);
    await user.click(screen.getByText(/debounces another function/));
    expect(useUiStore.getState().composerDraft?.text).toMatch(/debounces/);
  });

  it("offers to show the dragon only when its panel is hidden", async () => {
    const base = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...base, dragon: { ...base.dragon, enabled: true, panelOpen: true } } });
    const { unmount } = render(<WelcomeScreen />);
    expect(screen.queryByText("Show the ice dragon")).not.toBeInTheDocument();
    unmount();

    useSettingsStore.setState({ settings: { ...base, dragon: { ...base.dragon, enabled: true, panelOpen: false } } });
    const user = userEvent.setup();
    render(<WelcomeScreen />);
    await user.click(screen.getByText("Show the ice dragon"));
    expect(useSettingsStore.getState().settings.dragon.panelOpen).toBe(true);
    useSettingsStore.setState({ settings: base });
  });
});
