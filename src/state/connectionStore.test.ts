import { VinnieError } from "@/lib/errors";
import { installFakes, model, resetStores } from "@/test/fakes";
import { chooseModel, useConnectionStore } from "./connectionStore";
import { useSettingsStore } from "./settingsStore";

let fakes: ReturnType<typeof installFakes>;
const store = () => useConnectionStore.getState();

beforeEach(() => {
  resetStores();
  fakes = installFakes();
});

describe("connection store", () => {
  it("connects and loads models", async () => {
    fakes.provider.models = [model("b:1"), model("a:1")];
    await store().refresh();
    expect(store().status).toBe("connected");
    expect(store().info?.version).toBe("0.0.0-test");
    expect(store().models.map((m) => m.name)).toEqual(["b:1", "a:1"]);
    expect(store().selectedModel).toBe("b:1");
  });

  it("reports an unreachable server without loading models", async () => {
    fakes.provider.connectionError = new VinnieError("unreachable", "Could not connect");
    await store().refresh();
    expect(store().status).toBe("disconnected");
    expect(store().error?.kind).toBe("unreachable");
    expect(store().modelsStatus).toBe("idle");
  });

  it("handles an empty model list", async () => {
    fakes.provider.models = [];
    await store().refresh();
    expect(store().modelsStatus).toBe("loaded");
    expect(store().selectedModel).toBeNull();
  });

  it("prefers the configured default model when installed", async () => {
    useSettingsStore.setState((s) => ({ settings: { ...s.settings, defaultModel: "a:1" } }));
    fakes.provider.models = [model("b:1"), model("a:1")];
    await store().refresh();
    expect(store().selectedModel).toBe("a:1");
  });

  it("marks the connection lost when listing models fails with a network error", async () => {
    await store().refresh();
    fakes.provider.connectionError = new VinnieError("timeout", "slow");
    await store().refreshModels();
    expect(store().modelsStatus).toBe("error");
    expect(store().status).toBe("disconnected");
  });
});

describe("chooseModel", () => {
  const models = [model("a"), model("b")];
  it("keeps the current choice, then the default, then the first", () => {
    expect(chooseModel(models, "b", "a")).toBe("b");
    expect(chooseModel(models, "gone", "a")).toBe("a");
    expect(chooseModel(models, null, "missing")).toBe("a");
    expect(chooseModel([], "a", "a")).toBeNull();
  });
});
