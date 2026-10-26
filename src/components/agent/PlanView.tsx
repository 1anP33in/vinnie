import { Check, ChevronRight, Circle, Pencil, SkipForward, X } from "lucide-react";
import { useState } from "react";
import type { AgentPlan, PlanStep } from "@/agent/runtime/types";
import { useAgentStore } from "@/state/agentStore";

const ICON: Record<PlanStep["status"], React.ReactNode> = {
  done: <Check size={12} className="text-success" />,
  in_progress: <ChevronRight size={12} className="text-accent" />,
  pending: <Circle size={9} className="text-faint" />,
  skipped: <SkipForward size={11} className="text-faint" />,
};

function StepRow({ step, editable }: { step: PlanStep; editable: boolean }) {
  const edit = useAgentStore((s) => s.editPlanStep);
  const remove = useAgentStore((s) => s.removePlanStep);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(step.title);

  if (editing) {
    return (
      <li className="flex items-center gap-1.5">
        <input
          autoFocus
          value={draft}
          aria-label="Plan step"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              edit(step.id, draft);
              setEditing(false);
            } else if (e.key === "Escape") setEditing(false);
          }}
          onBlur={() => {
            edit(step.id, draft);
            setEditing(false);
          }}
          className="h-6 flex-1 rounded border border-accent bg-bg px-1.5 text-xs outline-none"
        />
      </li>
    );
  }
  return (
    <li className="group flex items-center gap-1.5 text-xs" data-status={step.status}>
      <span className="flex w-3.5 justify-center">{ICON[step.status]}</span>
      <span
        className={`min-w-0 flex-1 truncate ${
          step.status === "in_progress" ? "font-medium text-text" : step.status === "done" ? "text-muted" : "text-muted"
        } ${step.status === "skipped" ? "line-through" : ""}`}
        title={step.title}
      >
        {step.title}
      </span>
      {editable && step.status !== "done" && (
        <span className="hidden gap-0.5 group-hover:flex">
          <button
            type="button"
            aria-label={`Edit step: ${step.title}`}
            onClick={() => {
              setDraft(step.title);
              setEditing(true);
            }}
            className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-text"
          >
            <Pencil size={10} />
          </button>
          <button
            type="button"
            aria-label={`Remove step: ${step.title}`}
            onClick={() => remove(step.id)}
            className="rounded p-0.5 text-faint hover:bg-surface-3 hover:text-text"
          >
            <X size={10} />
          </button>
        </span>
      )}
    </li>
  );
}

export function PlanView({ plan, editable }: { plan: AgentPlan; editable: boolean }) {
  return (
    <div data-testid="agent-plan">
      <div className="mb-1 flex items-center gap-2 text-[11px] uppercase tracking-wider text-faint">
        Plan
        {plan.editedByUser && <span className="normal-case tracking-normal text-accent">edited by you</span>}
      </div>
      <ol className="flex flex-col gap-0.5">
        {plan.steps.map((s) => (
          <StepRow key={s.id} step={s} editable={editable} />
        ))}
      </ol>
    </div>
  );
}
