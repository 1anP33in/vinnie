// The AI provider abstraction. The chat UI and orchestration depend only on
// this interface, so additional providers (another local runtime, or a cloud
// API in a later phase) can be added without touching the chat interface.

import type {
  ChatTurn,
  ConnectionInfo,
  GenerationOutcome,
  ModelDetails,
  ModelInfo,
  StreamEvent,
} from "@/lib/ipc/types";

export type { ChatTurn, ConnectionInfo, GenerationOutcome, ModelInfo, StreamEvent };

export interface ChatRequest {
  model: string;
  messages: ChatTurn[];
  /** Tool definitions the model may call (function-calling format). */
  tools?: object[];
  /** Context window to request, in tokens. */
  numCtx?: number;
}

export interface GenerationHandle {
  readonly requestId: string;
  /** Resolves with the final outcome (partial when cancelled); rejects on failure. */
  readonly result: Promise<GenerationOutcome>;
  /** Request cancellation. Safe to call more than once or after completion. */
  cancel(): Promise<void>;
}

export interface AIProvider {
  readonly id: string;
  readonly displayName: string;
  /** Check reachability. `endpoint` overrides the saved endpoint (for testing unsaved settings). */
  checkConnection(endpoint?: string): Promise<ConnectionInfo>;
  listModels(endpoint?: string): Promise<ModelInfo[]>;
  streamChat(request: ChatRequest, onEvent: (event: StreamEvent) => void): GenerationHandle;
  /** Context length and capabilities of a model, if the provider reports them. */
  modelDetails(model: string): Promise<ModelDetails>;
}
