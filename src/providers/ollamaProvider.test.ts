import { VinnieError } from "@/lib/errors";
import type { StreamEvent } from "@/lib/ipc/types";

// Mock the Tauri IPC layer: `invoke` is scripted per test, and `Channel`
// records the handler so tests can push events through it.
const invoke = vi.fn();
let lastChannel: { onmessage: (e: StreamEvent) => void } | null = null;
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
  Channel: class {
    onmessage: (e: StreamEvent) => void = () => {};
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      lastChannel = this;
    }
  },
}));

const { createOllamaProvider } = await import("./ollamaProvider");

beforeEach(() => {
  invoke.mockReset();
  lastChannel = null;
});

describe("OllamaProvider", () => {
  it("maps connection failures to typed errors", async () => {
    invoke.mockRejectedValueOnce({ kind: "unreachable", message: "Could not connect to Ollama" });
    const err = await createOllamaProvider().checkConnection().catch((e) => e);
    expect(err).toBeInstanceOf(VinnieError);
    expect(err.kind).toBe("unreachable");
    expect(invoke).toHaveBeenCalledWith("check_connection", { endpoint: null });
  });

  it("tests an explicit endpoint", async () => {
    invoke.mockResolvedValueOnce({ endpoint: "http://h:1", version: "1.0" });
    await createOllamaProvider().checkConnection("http://h:1");
    expect(invoke).toHaveBeenCalledWith("check_connection", { endpoint: "http://h:1" });
  });

  it("returns the parsed model list", async () => {
    invoke.mockResolvedValueOnce([{ name: "qwen3:8b", sizeBytes: 1 }]);
    const models = await createOllamaProvider().listModels();
    expect(models[0]?.name).toBe("qwen3:8b");
  });

  it("forwards streamed events and resolves with the outcome", async () => {
    let finish!: (v: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    const events: StreamEvent[] = [];
    const handle = createOllamaProvider().streamChat(
      { model: "m", messages: [{ role: "user", content: "hi" }] },
      (e) => events.push(e),
    );

    const [command, args] = invoke.mock.calls[0]!;
    expect(command).toBe("chat_stream");
    expect(args.request).toMatchObject({ requestId: handle.requestId, model: "m" });

    lastChannel!.onmessage({ type: "content", text: "Hel" });
    lastChannel!.onmessage({ type: "content", text: "lo" });
    finish({ status: "completed", content: "Hello", thinking: "", stats: null });

    await expect(handle.result).resolves.toMatchObject({ status: "completed", content: "Hello" });
    expect(events).toEqual([
      { type: "content", text: "Hel" },
      { type: "content", text: "lo" },
    ]);
  });

  it("cancels by request id and skips cancel after completion", async () => {
    let finish!: (v: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((r) => (finish = r)));
    invoke.mockResolvedValueOnce(true); // cancel_generation
    const handle = createOllamaProvider().streamChat({ model: "m", messages: [] }, () => {});

    await handle.cancel();
    expect(invoke).toHaveBeenLastCalledWith("cancel_generation", { requestId: handle.requestId });

    finish({ status: "cancelled", content: "", thinking: "", stats: null });
    await handle.result;
    invoke.mockClear();
    await handle.cancel();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("propagates stream failures as VinnieErrors", async () => {
    invoke.mockRejectedValueOnce({ kind: "model_not_found", message: "model 'x' not found" });
    const handle = createOllamaProvider().streamChat({ model: "x", messages: [] }, () => {});
    await expect(handle.result).rejects.toMatchObject({ kind: "model_not_found" });
  });
});
