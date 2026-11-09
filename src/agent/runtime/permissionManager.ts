// Permission manager: decides whether a gated action may run, combining the
// agent mode, the user's permission settings, and scoped grants the user
// made from approval cards. Only the user can create grants; the model has
// no access to this class. The backend still enforces boundaries, the
// command policy, and denials independently.

import type { PermissionLevel, PermissionSettings } from "@/lib/ipc/types";
import { isReadOnly } from "@/mcp/classify";
import type { ApprovalDecision, ApprovalRequest, Authorization, PermissionScope } from "../types";
import type { AgentMode } from "./types";

export type Capability = "read" | "write" | "delete" | "execute" | "install" | "external";

export interface Grant {
  id: string;
  scope: Exclude<PermissionScope, "once">;
  capability: Capability;
  /** Exact command for execute/install; "*" for writes. */
  match: string;
  workspace: string;
  taskId: string | null;
  createdAt: number;
}

export interface AuthorizeInput {
  request: ApprovalRequest;
  capability: Capability;
  mode: AgentMode;
  permissions: PermissionSettings;
  taskId: string;
  workspace: string;
  /** Show the approval card and wait for the user's decision. */
  prompt(request: ApprovalRequest): Promise<ApprovalDecision>;
}

function levelFor(p: PermissionSettings, c: Capability, request: ApprovalRequest): PermissionLevel {
  switch (c) {
    case "external":
      // MCP tools use their own policy (per tool, else the server default).
      if (request.kind !== "mcp") return "approval";
      return request.policy === "allow" ? "allowed" : request.policy === "deny" ? "denied" : "approval";
    case "read":
      return p.read;
    case "write":
    case "delete":
      return p.write;
    case "execute":
      return p.execute;
    case "install":
      return p.installDependencies;
  }
}

function matchKey(request: ApprovalRequest): string {
  if (request.kind === "command") return request.command;
  if (request.kind === "read") return request.path;
  if (request.kind === "mcp") return `mcp:${request.server.id}:${request.tool}`;
  return "*";
}

const LABEL: Record<Capability, string> = {
  read: "read this file",
  write: "change files",
  delete: "delete files",
  execute: "run this command",
  install: "install dependencies",
  external: "use this external tool",
};

export class PermissionManager {
  private grants: Grant[] = [];

  async authorize(input: AuthorizeInput): Promise<Authorization> {
    const { request, capability, mode, permissions, taskId, workspace } = input;
    const externalReadOnly = capability === "external" && request.kind === "mcp" && isReadOnly(request.permission);
    const destructive = request.kind === "mcp" && request.destructive;
    if (mode === "ask" && capability !== "read" && !externalReadOnly) {
      return {
        approved: false,
        prompted: false,
        reason: "Vinnie is in Ask mode (read-only), so it cannot change files or run commands. Switch to Assist or Agent mode to allow changes.",
      };
    }
    const level = levelFor(permissions, capability, request);
    if (level === "denied") {
      return {
        approved: false,
        prompted: false,
        reason: `Your permission settings do not allow Vinnie to ${LABEL[capability]}.`,
      };
    }
    // Deletions, secret reads, and destructive external actions always ask;
    // Assist mode asks for everything.
    const alwaysAsk = capability === "delete" || capability === "read" || destructive || mode === "assist";
    if (!alwaysAsk && level === "allowed") return { approved: true, prompted: false };
    const rememberable = capability !== "delete" && capability !== "read" && !destructive;
    if (rememberable && this.findGrant(capability, matchKey(request), workspace, taskId)) {
      return { approved: true, prompted: false };
    }

    const decision = await input.prompt(request);
    if (!decision.approved) return { approved: false, prompted: true, reason: "The user denied this action." };
    const scope = decision.scope ?? "once";
    if ((scope === "task" || scope === "session") && rememberable) {
      this.grants.push({
        id: crypto.randomUUID(),
        scope,
        capability,
        match: matchKey(request),
        workspace,
        taskId: scope === "task" ? taskId : null,
        createdAt: Date.now(),
      });
    }
    return { approved: true, prompted: true, scope, manager: decision.manager };
  }

  findGrant(capability: Capability, match: string, workspace: string, taskId: string): Grant | undefined {
    return this.grants.find(
      (g) =>
        g.capability === capability &&
        g.workspace === workspace &&
        (g.match === "*" || g.match === match) &&
        (g.scope !== "task" || g.taskId === taskId),
    );
  }

  /** Task-scoped grants expire when the task ends. */
  endTask(taskId: string): void {
    this.grants = this.grants.filter((g) => !(g.scope === "task" && g.taskId === taskId));
  }

  /** Session grants expire when the session ends (or the project changes). */
  clearSession(): void {
    this.grants = [];
  }

  list(): Grant[] {
    return [...this.grants];
  }

  revoke(id: string): void {
    this.grants = this.grants.filter((g) => g.id !== id);
  }
}

/** One permission manager per app session. */
export const permissionManager = new PermissionManager();
