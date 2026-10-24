// File-changing tools. Every change is previewed as a diff, approved by the
// user (unless WRITE is set to "allowed"; deletions always ask), applied
// through the change manager (snapshot + history), and can be reverted.

import { z } from "zod";
import type { FileOperation } from "@/lib/ipc/types";
import type { ToolContext, ToolResult, VinnieTool } from "../types";

const reasonField = {
  reason: { type: "string", description: "One sentence explaining why, shown to the user." },
};

async function proposeAndApply(op: FileOperation, reason: string | undefined, ctx: ToolContext): Promise<ToolResult> {
  if (ctx.permissions.write === "denied") {
    return {
      ok: false,
      kind: "permission_denied",
      error: "The user's settings do not allow Vinnie to change files.",
    };
  }
  const preview = await ctx.services.changes.preview(op);
  const needsApproval = ctx.permissions.write !== "allowed" || op.kind === "delete";
  if (needsApproval) {
    const decision = await ctx.requestApproval({
      kind: "file",
      operation: op,
      preview,
      reason: reason ?? null,
      workspace: ctx.workspaceRoot,
    });
    if (!decision.approved) {
      return { ok: false, kind: "denied", error: "The user rejected this change. Do not retry it unless asked." };
    }
  }
  const record = await ctx.services.changes.apply(op, {
    access: { actor: "assistant", approved: needsApproval },
    taskId: ctx.taskId,
    description: reason ?? null,
  });
  ctx.filesChanged(op.kind === "move" ? [op.from, op.to] : [op.path]);
  const target = record.newPath ? `${record.path} → ${record.newPath}` : record.path;
  const verb = { create: "Created", modify: "Modified", delete: "Deleted", move: "Moved" }[record.kind];
  const stats = record.kind === "move" ? "" : ` (+${record.additions} −${record.deletions})`;
  return { ok: true, content: `${verb} ${target}${stats}. Change #${record.id} can be reverted from the Changes panel.` };
}

const pathField = { path: { type: "string", description: "File path relative to the project root." } };

const writeSchema = z.object({
  path: z.string().min(1).max(1024),
  content: z.string().max(5 * 1024 * 1024),
  reason: z.string().max(500).optional(),
});

export const createFile: VinnieTool<z.infer<typeof writeSchema>> = {
  name: "create_file",
  description: "Create a new file with the given content. Fails if the file already exists. The user reviews the change first.",
  inputSchema: {
    type: "object",
    properties: { ...pathField, content: { type: "string" }, ...reasonField },
    required: ["path", "content"],
  },
  schema: writeSchema,
  capability: "write",
  activityKind: "write",
  describe: (i) => `Preparing new file ${i.path}`,
  execute: (i, ctx) => proposeAndApply({ kind: "create", path: i.path, content: i.content }, i.reason, ctx),
};

export const writeFile: VinnieTool<z.infer<typeof writeSchema>> = {
  name: "write_file",
  description:
    "Replace the entire content of a file (creating it if needed). Always read the file first and send the complete new content. The user reviews a diff first.",
  inputSchema: {
    type: "object",
    properties: { ...pathField, content: { type: "string", description: "The complete new file content." }, ...reasonField },
    required: ["path", "content"],
  },
  schema: writeSchema,
  capability: "write",
  activityKind: "write",
  describe: (i) => `Preparing changes to ${i.path}`,
  execute: (i, ctx) => proposeAndApply({ kind: "write", path: i.path, content: i.content }, i.reason, ctx),
};

const deleteSchema = z.object({ path: z.string().min(1).max(1024), reason: z.string().max(500).optional() });

export const deleteFile: VinnieTool<z.infer<typeof deleteSchema>> = {
  name: "delete_file",
  description: "Delete a file (or an empty folder). Always requires the user's confirmation; the file can be restored from the Changes panel.",
  inputSchema: { type: "object", properties: { ...pathField, ...reasonField }, required: ["path"] },
  schema: deleteSchema,
  capability: "write",
  activityKind: "write",
  describe: (i) => `Preparing to delete ${i.path}`,
  execute: (i, ctx) => proposeAndApply({ kind: "delete", path: i.path }, i.reason, ctx),
};

const moveSchema = z.object({
  from: z.string().min(1).max(1024),
  to: z.string().min(1).max(1024),
  reason: z.string().max(500).optional(),
});

export const moveFile: VinnieTool<z.infer<typeof moveSchema>> = {
  name: "move_file",
  description: "Move or rename a file or folder inside the project. Never overwrites an existing file.",
  inputSchema: {
    type: "object",
    properties: {
      from: { type: "string", description: "Current path relative to the project root." },
      to: { type: "string", description: "New path relative to the project root." },
      ...reasonField,
    },
    required: ["from", "to"],
  },
  schema: moveSchema,
  capability: "write",
  activityKind: "write",
  describe: (i) => `Preparing to move ${i.from} to ${i.to}`,
  execute: (i, ctx) => proposeAndApply({ kind: "move", from: i.from, to: i.to }, i.reason, ctx),
};
