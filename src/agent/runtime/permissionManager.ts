// Permission manager: decides whether a gated action may run, combining the
// agent mode, the user's permission settings, and scoped grants the user
// made from approval cards. Only the user can create grants; the model has
// no access to this class. The backend still enforces boundaries, the
// command policy, and denials independently.

import type { PermissionSettings } from "@/lib/ipc/types";
import type { ApprovalDecision, ApprovalRequest, Authorization, PermissionScope } from "../types";
import type { AgentMode } from "./types";

export type Capability = "read" | "write" | "delete" | "execute" | "install";

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

function levelFor(p: PermissionSettings, c: Capability) {
  switch (c) {
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
  return "*";
}

const LABEL: Record<Capability, string> = {
  read: "read this file",
  write: "change files",
  delete: "delete files",
  execute: "run this command",
  install: "install dependencies",
};

export class PermissionManager {
  private grants: Grant[] = [];

  async authorize(input: AuthorizeInput): Promise<Authorization> {
    const { request, capability, mode, permissions, taskId, workspace } = input;
    if (mode === "ask" && capability !== "read") {
      return {
        approved: false,
        prompted: false,
        reason: "Vinnie is in Ask mode (read-only), so it cannot change files or run commands. Switch to Assist or Agent mode to allow changes.",
      };
    }
    const level = levelFor(permissions, capability);
    if (level === "denied") {
      return {
        approved: false,
        prompted: false,
        reason: `Your permission settings do not allow Vinnie to ${LABEL[capability]}.`,
      };
    }
    // Deletions and secret reads always ask; Assist mode asks for everything.
    const alwaysAsk = capability === "delete" || capability === "read" || mode === "assist";
    if (!alwaysAsk && level === "allowed") return { approved: true, prompted: false };
    if (capability !== "delete" && capability !== "read" && this.findGrant(capability, matchKey(request), workspace, taskId)) {
      return { approved: true, prompted: false };
    }

    const decision = await input.prompt(request);
    if (!decision.approved) return { approved: false, prompted: true, reason: "The user denied this action." };
    const scope = decision.scope ?? "once";
    if ((scope === "task" || scope === "session") && capability !== "delete" && capability !== "read") {
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
