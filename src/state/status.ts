import { useChatStore } from "./chatStore";
import { useConnectionStore } from "./connectionStore";

/** Human-readable description of what the app is doing right now. */
export function useCurrentOperation(): string | null {
  const generation = useChatStore((s) => s.generation);
  const connection = useConnectionStore((s) => s.status);
  const modelsStatus = useConnectionStore((s) => s.modelsStatus);

  if (generation) {
    switch (generation.phase) {
      case "preparing":
        return "Saving your message…";
      case "waiting":
        return `Waiting for ${generation.model} (loading the model can take a moment)…`;
      case "streaming":
        return generation.content
          ? `Generating with ${generation.model}…`
          : `${generation.model} is reasoning…`;
      case "stopping":
        return "Stopping…";
    }
  }
  if (connection === "checking") return "Checking Ollama connection…";
  if (modelsStatus === "loading") return "Loading installed models…";
  return null;
}
