// Pending approvals. Tools await `request()`; the approval card resolves it.
// The model cannot answer these: only user clicks call `respond()`.

import { create } from "zustand";
import { emitDragon } from "@/agent/events";
import type { ApprovalDecision, ApprovalRequest } from "@/agent/types";
import { useActivityStore } from "./activityStore";

export interface PendingApproval {
  id: string;
  request: ApprovalRequest;
  createdAt: number;
}

interface ApprovalState {
  pending: PendingApproval[];
  request(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalDecision>;
  respond(id: string, decision: ApprovalDecision): void;
  /** Deny everything still waiting (e.g. when generation is stopped). */
  denyAll(): void;
}

const resolvers = new Map<string, (d: ApprovalDecision) => void>();

function describe(request: ApprovalRequest): string {
  switch (request.kind) {
    case "command":
      return request.install
        ? `Approval: install ${request.install.packages.join(", ") || "dependencies"}`
        : `Approval: run ${request.command}`;
    case "file":
      return `Approval: ${request.preview.kind} ${request.preview.path}`;
    case "read":
      return `Approval: read ${request.path}`;
  }
}

export const useApprovalStore = create<ApprovalState>((set, get) => ({
  pending: [],

  request(request, signal) {
    const id = crypto.randomUUID();
    const activityId = useActivityStore.getState().start("approval", describe(request));
    emitDragon("waiting", "Waiting for your approval…");
    return new Promise<ApprovalDecision>((resolve) => {
      const finish = (decision: ApprovalDecision) => {
        resolvers.delete(id);
        set((s) => ({ pending: s.pending.filter((p) => p.id !== id) }));
        useActivityStore
          .getState()
          .finish(activityId, decision.approved ? "success" : "denied", decision.approved ? "Approved" : "Denied");
        resolve(decision);
      };
      resolvers.set(id, finish);
      set((s) => ({ pending: [...s.pending, { id, request, createdAt: Date.now() }] }));
      if (signal) {
        if (signal.aborted) finish({ approved: false });
        else signal.addEventListener("abort", () => resolvers.get(id)?.({ approved: false }), { once: true });
      }
    });
  },

  respond(id, decision) {
    resolvers.get(id)?.(decision);
  },

  denyAll() {
    for (const p of get().pending) resolvers.get(p.id)?.({ approved: false });
  },
}));
