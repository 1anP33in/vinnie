---
title: "Tool Registry"
description: "The single registry for native and MCP tools."
sidebar:
  order: 6
---
`src/agent/toolRegistry.ts` creates the registry. Every tool implements `VinnieTool` (`src/agent/types.ts`):

```ts
interface VinnieTool<Input> {
  name: string;                 // model-facing, ^[a-z][a-z0-9_]{0,63}$
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema sent to the model
  schema: z.ZodType<Input>;     // runtime validator
  category: ToolCategory;       // READ | SEARCH | WRITE | DELETE | EXECUTE | DEPENDENCY | PROJECT | EXTERNAL
  riskLevel: "safe" | "moderate" | "high";
  activityKind: ActivityKind;
  source?: "native" | "mcp";
  settingsKey?: string;         // e.g. "mcp:github:list_issues"
  displayName?: string;         // e.g. "github.list_issues"
  serverId?: string;
  permission?: ToolPermission;  // MCP tools
  available?(): boolean;        // false while the MCP server is down
  describe(input: Input): string;
  execute(input: Input, ctx: ToolContext): Promise<ToolResult>;
}
```

## Registry behavior

- `register` / `unregister`, `list()` (definitions with `enabled` and `available`), `specs(names)` (Ollama
  function-calling format), and `subscribe` (change notifications).
- `execute(name, input, ctx)` never throws. It refuses unknown tools, invalid JSON, schema violations, **disabled**
  tools (via `setEnabledCheck`), unavailable tools, and calls after cancellation, and returns a structured
  `ToolResult`.

## ToolResult

```ts
interface ToolResult {
  success: boolean;
  outcome: "succeeded" | "failed" | "denied" | "cancelled" | "timed_out";
  summary: string;             // what the model reads
  output?: unknown;            // structured data
  error?: { code: FailureCode; message: string; details?: string };
  metadata?: { durationMs?: number; filesChanged?: string[]; exitCode?: number | null; changeIds?: number[] };
}
```

## ToolContext

Tools receive services, the task id, an abort signal, permissions, mode, the workspace root,
`authorize(request, capability)` (the only way to get approval), `runCommand`, `filesChanged`, and agent hooks
(`updatePlan`, `remember`, `metadata`).
