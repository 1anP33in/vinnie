import { DEFAULT_SETTINGS, validateEndpoint, validateModelName, validateSettings } from "./validation";

describe("settings validation", () => {
  it("accepts valid endpoints", () => {
    expect(validateEndpoint("http://localhost:11434")).toBeNull();
    expect(validateEndpoint(" https://ollama.internal:443/ ")).toBeNull();
    expect(validateEndpoint("http://192.168.1.10:11434/ollama")).toBeNull();
  });

  it.each([
    ["", /empty/],
    ["localhost:11434", /http/],
    ["not a url", /full URL/],
    ["ftp://host", /http/],
    ["http://user:pw@localhost:11434", /credentials/],
    ["http://localhost:11434/?a=1", /query/],
  ])("rejects %j", (value, message) => {
    expect(validateEndpoint(value)).toMatch(message);
  });

  it("validates model names", () => {
    expect(validateModelName(null)).toBeNull();
    expect(validateModelName("")).toBeNull();
    expect(validateModelName("qwen3:8b")).toBeNull();
    expect(validateModelName("two words")).toMatch(/not valid/);
  });

  it("collects field errors", () => {
    expect(validateSettings(DEFAULT_SETTINGS)).toEqual({});
    const errors = validateSettings({ ...DEFAULT_SETTINGS, ollamaEndpoint: "nope", defaultModel: "a b" });
    expect(Object.keys(errors).sort()).toEqual(["defaultModel", "ollamaEndpoint"]);
  });
});
