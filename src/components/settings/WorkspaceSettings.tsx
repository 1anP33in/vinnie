import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { IconButton } from "@/components/common/Button";
import { describeError, toVinnieError, type VinnieError } from "@/lib/errors";
import type { AllowedCommand, PermissionLevel, PermissionSettings } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { useProjectStore } from "@/state/projectStore";

const CAPABILITIES: { key: keyof PermissionSettings; label: string; help: string }[] = [
  { key: "read", label: "Read files", help: "Search and read project files. Files that may hold secrets (.env, keys) always ask first." },
  { key: "write", label: "Change files", help: "Create, edit, move, and delete files. Deletions always ask first." },
  { key: "execute", label: "Run commands", help: "Commands outside the low-risk list (tests, builds, git status). Destructive commands are always blocked." },
  { key: "installDependencies", label: "Install dependencies", help: "npm install, pip install, cargo add, and similar." },
];

const LEVELS: { value: PermissionLevel; label: string }[] = [
  { value: "allowed", label: "Allowed" },
  { value: "approval", label: "Ask me" },
  { value: "denied", label: "Never" },
];

export function PermissionEditor({
  value,
  onChange,
}: {
  value: PermissionSettings;
  onChange(next: PermissionSettings): void;
}) {
  return (
    <div className="flex flex-col gap-3">
      {CAPABILITIES.map((c) => (
        <div key={c.key} className="flex items-start justify-between gap-4">
          <span>
            <span className="block text-sm">{c.label}</span>
            <span className="block text-xs text-faint">{c.help}</span>
          </span>
          <select
            aria-label={c.label}
            value={value[c.key]}
            onChange={(e) => onChange({ ...value, [c.key]: e.target.value as PermissionLevel })}
            className="h-8 shrink-0 rounded-md border border-border bg-bg px-2 text-sm outline-none focus:border-accent"
          >
            {LEVELS.map((l) => (
              <option key={l.value} value={l.value}>
                {l.label}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

/** Commands the user chose "Always allow" for in the current project. */
export function AllowedCommands() {
  const project = useProjectStore((s) => s.project);
  const [commands, setCommands] = useState<AllowedCommand[] | null>(null);
  const [error, setError] = useState<VinnieError | null>(null);
  const available = project?.status === "available";

  useEffect(() => {
    if (!available) return;
    let cancelled = false;
    getServices()
      .process.allowedCommands()
      .then((list) => !cancelled && setCommands(list))
      .catch((err) => !cancelled && setError(toVinnieError(err)));
    return () => {
      cancelled = true;
    };
  }, [available, project?.path]);

  const remove = async (command: string) => {
    try {
      await getServices().process.removeAllowedCommand(command);
      setCommands((c) => c?.filter((x) => x.command !== command) ?? null);
    } catch (err) {
      setError(toVinnieError(err));
    }
  };

  if (!available) return <p className="text-xs text-faint">Select a project to see its always-allowed commands.</p>;
  if (error) return <p className="text-xs text-danger">{describeError(error).detail}</p>;
  if (!commands) return null;
  if (commands.length === 0) {
    return <p className="text-xs text-faint">No commands are always allowed in {project?.name}.</p>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {commands.map((c) => (
        <li key={c.command} className="flex items-center gap-2 rounded-md border border-border bg-bg px-2.5 py-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{c.command}</code>
          <IconButton label={`Stop always allowing ${c.command}`} className="size-6" onClick={() => void remove(c.command)}>
            <Trash2 size={12} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}
