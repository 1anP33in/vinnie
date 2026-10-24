import { z } from "zod";
import { getServices } from "@/services";
import { installFakes, resetStores } from "@/test/fakes";
import { createToolRegistry, normalizeArguments } from "./toolRegistry";
import type { ToolContext, VinnieTool } from "./types";

const echoSchema = z.object({ text: z.string().min(1) });
const echo: VinnieTool<z.infer<typeof echoSchema>> = {
  name: "echo",
  description: "Echo text",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  schema: echoSchema,
  capability: "read",
  activityKind: "read",
  describe: (i) => `Echo ${i.text}`,
  execute: async (i) => ({ ok: true, content: i.text }),
};

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    taskId: "task-1",
    signal: new AbortController().signal,
    services: getServices(),
    permissions: { read: "allowed", write: "approval", execute: "approval", installDependencies: "approval" },
    workspaceRoot: "C:\\Projects\\demo",
    requestApproval: async () => ({ approved: false }),
    runCommand: async () => {
      throw new Error("not used");
    },
    filesChanged: () => {},
    projectChanged: () => {},
    ...overrides,
  };
}

beforeEach(() => {
  resetStores();
  installFakes();
});

describe("tool registry", () => {
  it("starts empty and registers tools", () => {
    const registry = createToolRegistry();
    expect(registry.list()).toEqual([]);
    registry.register(echo);
    expect(registry.list()).toEqual([
      { name: "echo", description: "Echo text", inputSchema: echo.inputSchema, capability: "read" },
    ]);
    expect(() => registry.register(echo)).toThrow(/already registered/);
    expect(() => registry.register({ ...echo, name: "Bad Name!" })).toThrow(/Invalid tool name/);
    expect(registry.unregister("echo")).toBe(true);
  });

  it("exposes Ollama function specs", () => {
    const registry = createToolRegistry();
    registry.register(echo);
    expect(registry.specs()).toEqual([
      { type: "function", function: { name: "echo", description: "Echo text", parameters: echo.inputSchema } },
    ]);
  });

  it("validates input before executing", async () => {
    const registry = createToolRegistry();
    const execute = vi.fn(echo.execute);
    registry.register({ ...echo, execute });
    const bad = await registry.execute("echo", { text: 42 }, ctx());
    expect(bad).toMatchObject({ ok: false, kind: "invalid_input" });
    expect(execute).not.toHaveBeenCalled();
    // Models sometimes send arguments as a JSON string.
    expect(await registry.execute("echo", '{"text":"hi"}', ctx())).toEqual({ ok: true, content: "hi" });
  });

  it("reports unknown tools and execution errors without throwing", async () => {
    const registry = createToolRegistry();
    registry.register({
      ...echo,
      execute: async () => {
        throw { kind: "forbidden", message: "That path resolves outside the project folder." };
      },
    });
    expect(await registry.execute("nope", {}, ctx())).toMatchObject({ ok: false, kind: "unknown_tool" });
    expect(await registry.execute("echo", { text: "x" }, ctx())).toEqual({
      ok: false,
      kind: "forbidden",
      error: "That path resolves outside the project folder.",
    });
  });

  it("does not run tools after the request was stopped", async () => {
    const registry = createToolRegistry();
    registry.register(echo);
    const controller = new AbortController();
    controller.abort();
    expect(await registry.execute("echo", { text: "x" }, ctx({ signal: controller.signal }))).toMatchObject({
      ok: false,
      kind: "denied",
    });
  });

  it("normalizes arguments", () => {
    expect(normalizeArguments('{"a":1}')).toEqual({ a: 1 });
    expect(normalizeArguments("")).toEqual({});
    expect(normalizeArguments(undefined)).toEqual({});
    expect(normalizeArguments("not json")).toBe("not json");
  });
});
