import { useState } from "react";
import { AGENT_PROMPT_VERSION } from "@/agent/runtime/systemPrompt";
import { redact } from "@/agent/runtime/redact";
import type { AgentTask } from "@/agent/runtime/types";
import { useAgentStore } from "@/state/agentStore";
import { useSettingsStore } from "@/state/settingsStore";
import { TaskTimeline } from "./TaskTimeline";
import { formatClock, formatElapsed, STATUS_TEXT, useNow } from "./taskFormat";

function DebugView({ task }: { task: AgentTask }) {
  const tools = task.steps.filter((s) => s.tool);
  return (
    <div className="flex flex-col gap-3 text-xs" data-testid="task-debug">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-0.5">
        <dt className="text-faint">Task ID</dt>
        <dd className="font-mono">{task.id}</dd>
        <dt className="text-faint">Model</dt>
        <dd className="font-mono">{task.model}</dd>
        <dt className="text-faint">Prompt</dt>
        <dd>v{AGENT_PROMPT_VERSION} · mode {task.mode} · intent {task.intent}</dd>
        <dt className="text-faint">Iterations</dt>
        <dd>{task.iteration}</dd>
        <dt className="text-faint">Tool calls</dt>
        <dd>{task.toolCalls}</dd>
        <dt className="text-faint">Retries</dt>
        <dd>{task.retries}</dd>
        <dt className="text-faint">Tokens</dt>
        <dd>
          {task.usage.promptTokens.toLocaleString()} prompt · {task.usage.completionTokens.toLocaleString()} completion · peak{" "}
          {task.usage.peakPromptTokens.toLocaleString()} of {task.usage.contextBudget.toLocaleString()} context
        </dd>
        <dt className="text-faint">Result</dt>
        <dd>{task.result ? `${task.result.status}: ${task.result.reason}` : "running"}</dd>
        <dt className="text-faint">Verification</dt>
        <dd>{task.result?.verification?.summary ?? "—"}</dd>
      </dl>
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">Task memory</div>
        <ul className="list-disc pl-5 text-muted">
          {task.memory.length ? task.memory.map((m, i) => <li key={i}>{m}</li>) : <li>(empty)</li>}
        </ul>
      </div>
      <div>
        <div className="mb-1 text-[11px] uppercase tracking-wider text-faint">Tool calls (secrets redacted)</div>
        <table className="w-full table-fixed border-collapse font-mono text-[11px]">
          <thead className="text-left text-faint">
            <tr>
              <th className="w-20 pb-1">Time</th>
              <th className="w-36 pb-1">Tool</th>
              <th className="pb-1">Arguments</th>
              <th className="pb-1">Result</th>
              <th className="w-16 pb-1">Duration</th>
            </tr>
          </thead>
          <tbody>
            {tools.map((s) => (
              <tr key={s.id} className="border-t border-border/60 align-top">
                <td className="py-1 text-faint">{formatClock(s.startedAt)}</td>
                <td className={`py-1 ${s.status === "succeeded" ? "" : "text-danger"}`}>
                  {s.tool!.name}
                  {s.tool!.errorCode && <div className="text-[10px]">{s.tool!.errorCode}</div>}
                </td>
                <td className="py-1 pr-2">
                  <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(redact(s.tool!.arguments), null, 1)}</pre>
                </td>
                <td className="py-1 pr-2">
                  <pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all">{String(redact(s.tool!.resultSummary ?? ""))}</pre>
                </td>
                <td className="py-1 text-faint">{s.endedAt ? `${((s.endedAt - s.startedAt) / 1000).toFixed(1)}s` : "…"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Bottom-panel tab: pick a task, see its full timeline and (optionally) debug details. */
export function TaskPanel() {
  const order = useAgentStore((s) => s.order);
  const tasks = useAgentStore((s) => s.tasks);
  const debugEnabled = useSettingsStore((s) => s.settings.agent.debugView);
  const [selected, setSelected] = useState<string | null>(null);
  const [debug, setDebug] = useState(false);
  const id = selected && tasks[selected] ? selected : order.at(-1);
  const task = id ? tasks[id] : undefined;
  const now = useNow(!!task && !task.completedAt);

  if (!task) return <p className="px-3 py-3 text-xs text-faint">No agent tasks yet. Ask Vinnie to do something in your project.</p>;
  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-panel">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <select
          aria-label="Task"
          value={task.id}
          onChange={(e) => setSelected(e.target.value)}
          className="max-w-md truncate rounded border border-border bg-bg px-1 py-0.5"
        >
          {[...order].reverse().map((tid) => (
            <option key={tid} value={tid}>
              {formatClock(tasks[tid]!.startedAt)} — {tasks[tid]!.userRequest.slice(0, 60)}
            </option>
          ))}
        </select>
        <span className="text-faint">
          {STATUS_TEXT[task.status]} · {formatElapsed((task.completedAt ?? now) - task.startedAt)}
        </span>
        {debugEnabled && (
          <label className="ml-auto flex items-center gap-1 text-faint">
            <input type="checkbox" checked={debug} onChange={(e) => setDebug(e.target.checked)} /> Debug view
          </label>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {debug && debugEnabled ? <DebugView task={task} /> : <TaskTimeline steps={task.steps} />}
      </div>
    </div>
  );
}
