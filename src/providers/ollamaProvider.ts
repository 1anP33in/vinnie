import { commands } from "@/lib/ipc/commands";
import { newRequestId } from "@/lib/id";
import type { AIProvider, ChatRequest, GenerationHandle, StreamEvent } from "./types";

/** Ollama provider. Network access happens in the Rust backend. */
export function createOllamaProvider(): AIProvider {
  return {
    id: "ollama",
    displayName: "Ollama",
    checkConnection: (endpoint) => commands.checkConnection(endpoint),
    listModels: (endpoint) => commands.listModels(endpoint),
    streamChat(request: ChatRequest, onEvent: (event: StreamEvent) => void): GenerationHandle {
      const requestId = newRequestId();
      let settled = false;
      const result = commands
        .chatStream({ requestId, model: request.model, messages: request.messages }, onEvent)
        .finally(() => {
          settled = true;
        });
      return {
        requestId,
        result,
        async cancel() {
          if (settled) return;
          try {
            await commands.cancelGeneration(requestId);
          } catch {
            // The generation may have just finished; the result promise
            // reports the real outcome either way.
          }
        },
      };
    },
  };
}
