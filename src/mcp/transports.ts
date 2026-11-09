// Transports that plug Vinnie's backend into the official MCP SDK client.
//
// - TauriStdioTransport: the Rust backend launches the configured server
//   process (no shell, restricted environment, hidden window) and relays
//   newline-delimited JSON-RPC over stdin/stdout.
// - createTauriFetch: a `fetch` for the SDK's StreamableHTTPClientTransport.
//   Requests go through the backend, which only talks to the server's own
//   origin and adds stored credentials, so secrets never reach the webview.
//
// The SDK still does all protocol work (initialization, sessions, SSE,
// request ids, timeouts, cancellation).

import type { FetchLike, Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { JSONRPCMessageSchema, type JSONRPCMessage } from "@modelcontextprotocol/sdk/types.js";
import type { McpService } from "@/services";

export interface StdioHooks {
  onStderr(line: string): void;
  onExit(code: number | null): void;
}

export class TauriStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;
  private started = false;
  private closed = false;

  constructor(
    private readonly serverId: string,
    private readonly mcp: McpService,
    private readonly hooks: StdioHooks,
  ) {}

  async start(): Promise<void> {
    if (this.started) throw new Error("Transport already started.");
    this.started = true;
    await this.mcp.stdioStart(this.serverId, (event) => {
      switch (event.type) {
        case "message":
          this.receive(event.line);
          break;
        case "stderr":
          this.hooks.onStderr(event.line);
          break;
        case "dropped":
          this.onerror?.(new Error(event.reason));
          break;
        case "exit":
          this.hooks.onExit(event.code);
          this.finish();
          break;
      }
    });
  }

  private receive(line: string): void {
    let message: JSONRPCMessage;
    try {
      message = JSONRPCMessageSchema.parse(JSON.parse(line));
    } catch {
      this.onerror?.(new Error("The server wrote a line that is not a JSON-RPC message."));
      return;
    }
    this.onmessage?.(message);
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.closed) throw new Error("The server process is not running.");
    await this.mcp.stdioSend(this.serverId, JSON.stringify(message));
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.mcp.stdioStop(this.serverId).catch(() => false);
    this.finish();
  }

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.onclose?.();
  }
}

/** Statuses whose responses must not have a body (Response() rejects one). */
const NULL_BODY = new Set([101, 103, 204, 205, 304]);

function headersToRecord(init: HeadersInit | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  new Headers(init).forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

export function createTauriFetch(serverId: string, mcp: McpService): FetchLike {
  return async (input, init) => {
    const url = typeof input === "string" ? input : input.href;
    const body = init?.body;
    if (body != null && typeof body !== "string") throw new Error("Only text request bodies are supported.");
    const requestId = crypto.randomUUID();
    const encoder = new TextEncoder();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let done = false;
    const stream = new ReadableStream<Uint8Array>({
      start(c) {
        controller = c;
      },
      cancel() {
        done = true;
        void mcp.httpAbort(requestId);
      },
    });
    const signal = init?.signal;
    const onAbort = () => {
      if (done) return;
      done = true;
      void mcp.httpAbort(requestId);
      controller.error(new DOMException("The request was aborted.", "AbortError"));
    };
    if (signal?.aborted) throw new DOMException("The request was aborted.", "AbortError");
    signal?.addEventListener("abort", onAbort, { once: true });

    const head = await mcp.httpFetch(
      serverId,
      { requestId, url, method: init?.method ?? "GET", headers: headersToRecord(init?.headers), body: body ?? null },
      (event) => {
        if (done) return;
        if (event.type === "chunk") controller.enqueue(encoder.encode(event.data));
        else if (event.type === "end") {
          done = true;
          signal?.removeEventListener("abort", onAbort);
          controller.close();
        } else {
          done = true;
          signal?.removeEventListener("abort", onAbort);
          controller.error(new Error(event.message));
        }
      },
    );
    return new Response(NULL_BODY.has(head.status) ? null : stream, {
      status: head.status,
      statusText: head.statusText,
      headers: head.headers,
    });
  };
}
