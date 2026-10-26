import { useState } from "react";
import { describeError } from "@/lib/errors";
import { getServices } from "@/services";
import { useConnectionStore } from "@/state/connectionStore";
import { Spinner } from "./Spinner";

const WAIT_MS = 30_000;
const POLL_MS = 1_000;

/** The Ollama llama icon (from Ollama's own app icon), on a light badge so it reads in dark mode. */
export function OllamaIcon({ size = 16 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded bg-white"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <img src="/ollama.png" alt="" width={size - 2} height={size - 2} draggable={false} />
    </span>
  );
}

/**
 * Starts `ollama serve` in the background, then waits for the server to
 * answer and reconnects. Shown wherever Vinnie can't reach Ollama.
 */
export function LaunchOllamaButton({ compact = false }: { compact?: boolean }) {
  const [state, setState] = useState<"idle" | "launching" | "waiting">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const launch = async () => {
    setState("launching");
    setMessage(null);
    try {
      const result = await getServices().system.launchOllama();
      setState("waiting");
      const deadline = Date.now() + WAIT_MS;
      while (Date.now() < deadline) {
        if (await useConnectionStore.getState().check()) {
          await useConnectionStore.getState().refreshModels();
          setState("idle");
          setMessage(result.status === "alreadyRunning" ? "Ollama was already running." : null);
          return;
        }
        await new Promise((r) => setTimeout(r, POLL_MS));
      }
      setMessage("Ollama was started but isn't answering yet. Give it a few more seconds, then retry.");
    } catch (err) {
      setMessage(describeError(err).detail);
    }
    setState("idle");
  };

  const busy = state !== "idle";
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void launch()}
        disabled={busy}
        title="Start the Ollama server (ollama serve) in the background"
        className={`inline-flex items-center justify-center gap-1.5 rounded-md border border-border-strong bg-surface-2 font-medium text-text transition-colors hover:bg-surface-3 disabled:opacity-70 ${
          compact ? "h-6 px-2 text-[11px]" : "h-7 px-2.5 text-xs"
        }`}
      >
        {busy ? <Spinner size={compact ? 11 : 13} /> : <OllamaIcon size={compact ? 13 : 15} />}
        {state === "launching" ? "Starting Ollama…" : state === "waiting" ? "Waiting for Ollama…" : "Launch Ollama"}
      </button>
      {message && (
        <span className="max-w-xs text-[11px] text-muted" role="status">
          {message}
        </span>
      )}
    </span>
  );
}
