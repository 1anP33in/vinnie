import { describeError, toVinnieError, VinnieError } from "./errors";

describe("toVinnieError", () => {
  it("maps backend error objects by kind", () => {
    const e = toVinnieError({ kind: "unreachable", message: "Could not connect" });
    expect(e).toBeInstanceOf(VinnieError);
    expect(e.kind).toBe("unreachable");
    expect(e.message).toBe("Could not connect");
  });

  it("treats unknown kinds, strings, and junk as unknown", () => {
    expect(toVinnieError({ kind: "weird", message: "x" }).kind).toBe("unknown");
    expect(toVinnieError("boom").message).toBe("boom");
    expect(toVinnieError(42).kind).toBe("unknown");
    expect(toVinnieError(new Error("plain")).message).toBe("plain");
  });

  it("returns the same instance for VinnieErrors", () => {
    const e = new VinnieError("timeout", "slow");
    expect(toVinnieError(e)).toBe(e);
  });
});

describe("describeError", () => {
  it("gives actionable guidance when Ollama is unreachable", () => {
    const d = describeError({ kind: "unreachable", message: "refused" }, { endpoint: "http://localhost:11434" });
    expect(d.title).toBe("Can't reach Ollama");
    expect(d.hint).toContain("http://localhost:11434");
    expect(d.command).toBe("ollama serve");
  });

  it("suggests pulling a missing model", () => {
    const d = describeError(new VinnieError("model_not_found", "model 'x' not found"), { model: "llama3.2" });
    expect(d.command).toBe("ollama pull llama3.2");
  });

  it("explains persistence failures honestly", () => {
    const d = describeError(new VinnieError("database", "disk full"));
    expect(d.hint).toMatch(/not saved/i);
  });
});
