import { z } from "zod";
import { getServices } from "@/services";
import { installFakes, resetStores } from "@/test/fakes";
import { createToolRegistry, normalizeArguments } from "./toolRegistry";
import { toolSuccess, type ToolContext, type VinnieTool } from "./types";

const echoSchema = z.object({ text: z.string().min(1) });
const echo: VinnieTool<z.infer<typeof echoSchema>> = {
  name: "echo",
  description: "Echo text",
  inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
  schema: echoSchema,
  category: "READ",
  riskLevel: "safe",
  activityKind: "read",
  describe: (i) => `Echo ${i.text}`,
  execute: async (i) => toolSuccess(i.text),
};

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    taskId: "task-1",
    signal: new AbortController().signal,
    services: getServices(),
    permissions: { read: "allowed", write: "approval", execute: "approval", installDependencies: "approval" },
    workspaceRoot: "C:\\Projects\\demo",
    mode: "agent",
    authorize: async () => ({ approved: false, prompted: true }),
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
      { name: "echo", description: "Echo text", inputSchema: echo.inputSchema, category: "READ", riskLevel: "safe" },
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
    expect(bad).toMatchObject({ success: false, error: { code: "INVALID_ARGUMENT" } });
    expect(execute).not.toHaveBeenCalled();
    // Models sometimes send arguments as a JSON string.
    expect(await registry.execute("echo", '{"text":"hi"}', ctx())).toMatchObject({ success: true, summary: "hi" });
    expect(await registry.execute("echo", "{not json", ctx())).toMatchObject({ success: false, error: { code: "INVALID_ARGUMENT" } });
  });

  it("reports unknown tools and execution errors without throwing", async () => {
    const registry = createToolRegistry();
    registry.register({
      ...echo,
      execute: async () => {
        throw { kind: "forbidden", message: "That path resolves outside the project folder." };
      },
    });
    expect(await registry.execute("nope", {}, ctx())).toMatchObject({ success: false, error: { code: "TOOL_FAILURE" } });
    expect(await registry.execute("echo", { text: "x" }, ctx())).toMatchObject({
      success: false,
      outcome: "failed",
      summary: "That path resolves outside the project folder.",
      error: { code: "INVALID_ARGUMENT" },
    });
  });

  it("does not run tools after the request was stopped", async () => {
    const registry = createToolRegistry();
    registry.register(echo);
    const controller = new AbortController();
    controller.abort();
    expect(await registry.execute("echo", { text: "x" }, ctx({ signal: controller.signal }))).toMatchObject({
      success: false,
      outcome: "cancelled",
      error: { code: "CANCELLED" },
    });
  });

  it("normalizes arguments", () => {
    expect(normalizeArguments('{"a":1}')).toEqual({ a: 1 });
    expect(normalizeArguments("")).toEqual({});
    expect(normalizeArguments(undefined)).toEqual({});
    expect(normalizeArguments("not json")).toBe("not json");
  });
});
