import { createToolRegistry } from "./toolRegistry";
import type { Tool } from "./types";

const tool: Tool = {
  name: "fs.read_file",
  description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  permissions: ["read-project"],
  source: { kind: "native" },
  execute: async () => ({ ok: true, output: "" }),
};

describe("tool registry", () => {
  it("starts empty", () => {
    expect(createToolRegistry().list()).toEqual([]);
  });

  it("registers, lists definitions without executors, and unregisters", () => {
    const registry = createToolRegistry();
    registry.register(tool);
    expect(registry.get("fs.read_file")).toBe(tool);
    expect(registry.list()).toEqual([expect.not.objectContaining({ execute: expect.anything() })]);
    expect(() => registry.register(tool)).toThrow(/already registered/);
    expect(registry.unregister("fs.read_file")).toBe(true);
    expect(registry.list()).toEqual([]);
  });
});
