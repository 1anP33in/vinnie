import { PackageOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/common/Button";
import { CopyButton } from "@/components/common/CopyButton";
import { getServices } from "@/services";

export const EXAMPLE_PULL_COMMAND = "ollama pull qwen3:8b";

export function NoModelsNotice({ onRefresh, refreshing }: { onRefresh(): void; refreshing?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 text-left">
      <div className="flex items-center gap-2 font-medium">
        <PackageOpen size={16} className="text-accent" /> No models installed
      </div>
      <p className="mt-1.5 text-sm text-muted">
        Ollama is running, but it has no models yet. Vinnie never downloads models on its own. Install one from a
        terminal, for example:
      </p>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-code px-3 py-2 font-mono text-xs">
        <span className="flex-1 select-all">{EXAMPLE_PULL_COMMAND}</span>
        <CopyButton text={EXAMPLE_PULL_COMMAND} label="Copy command" />
      </div>
      <p className="mt-2 text-xs text-faint">
        Any chat model works. Browse the{" "}
        <a
          href="https://ollama.com/library"
          className="text-accent underline"
          onClick={(e) => {
            e.preventDefault();
            void getServices().system.openExternalUrl("https://ollama.com/library").catch(() => {});
          }}
        >
          Ollama model library
        </a>{" "}
        and choose one that fits your hardware.
      </p>
      <Button className="mt-4" size="sm" onClick={onRefresh} disabled={refreshing} icon={<RefreshCw size={13} />}>
        {refreshing ? "Refreshing…" : "Refresh model list"}
      </Button>
    </div>
  );
}
