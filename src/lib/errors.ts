// Error normalization and user-facing descriptions.

export type ErrorKind =
  | "validation"
  | "not_found"
  | "database"
  | "unreachable"
  | "timeout"
  | "http"
  | "model_not_found"
  | "malformed"
  | "interrupted"
  | "busy"
  | "io"
  | "internal"
  | "forbidden"
  | "blocked"
  | "permission_denied"
  | "approval_required"
  | "conflict"
  | "tools_unsupported"
  | "no_workspace"
  | "unknown";

const KNOWN_KINDS = new Set<string>([
  "validation",
  "not_found",
  "database",
  "unreachable",
  "timeout",
  "http",
  "model_not_found",
  "malformed",
  "interrupted",
  "busy",
  "io",
  "internal",
  "forbidden",
  "blocked",
  "permission_denied",
  "approval_required",
  "conflict",
  "tools_unsupported",
  "no_workspace",
]);

export class VinnieError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.name = "VinnieError";
    this.kind = kind;
  }
}

/** Convert anything thrown (backend error objects, Errors, strings) into a VinnieError. */
export function toVinnieError(err: unknown): VinnieError {
  if (err instanceof VinnieError) return err;
  if (err && typeof err === "object" && "message" in err) {
    const message = String((err as { message: unknown }).message);
    const rawKind = "kind" in err ? String((err as { kind: unknown }).kind) : "unknown";
    const kind = (KNOWN_KINDS.has(rawKind) ? rawKind : "unknown") as ErrorKind;
    return new VinnieError(kind, message);
  }
  if (typeof err === "string") return new VinnieError("unknown", err);
  return new VinnieError("unknown", "An unexpected error occurred.");
}

export interface ErrorDescription {
  title: string;
  detail: string;
  hint?: string;
  /** A shell command the user can copy to resolve the problem. */
  command?: string;
}

export interface ErrorContext {
  endpoint?: string;
  model?: string | null;
}

/** Turn an error into friendly, actionable copy. */
export function describeError(err: unknown, ctx: ErrorContext = {}): ErrorDescription {
  const e = toVinnieError(err);
  switch (e.kind) {
    case "unreachable":
      return {
        title: "Can't reach Ollama",
        detail: e.message,
        hint: `Make sure Ollama is running (open the Ollama app or run "ollama serve") and that the endpoint${
          ctx.endpoint ? ` ${ctx.endpoint}` : ""
        } is correct in Settings.`,
        command: "ollama serve",
      };
    case "timeout":
      return {
        title: "Ollama is taking too long",
        detail: e.message,
        hint: "Large models can take a while to load. Wait a moment and try again, or pick a smaller model.",
      };
    case "model_not_found":
      return {
        title: "Model not installed",
        detail: e.message,
        hint: "Install the model with Ollama, then refresh the model list.",
        command: ctx.model ? `ollama pull ${ctx.model}` : undefined,
      };
    case "malformed":
      return {
        title: "Unexpected response",
        detail: e.message,
        hint: "Check that the endpoint in Settings points to an Ollama server.",
      };
    case "interrupted":
      return {
        title: "Response interrupted",
        detail: e.message,
        hint: "The partial response was kept. You can retry to generate a new one.",
      };
    case "http":
      return { title: "Ollama reported an error", detail: e.message };
    case "database":
      return {
        title: "Couldn't save to the local database",
        detail: e.message,
        hint: "Your data was not saved. Try again; if this keeps happening, check free disk space.",
      };
    case "validation":
      return { title: "Please check your input", detail: e.message };
    case "not_found":
      return { title: "Not found", detail: e.message };
    case "busy":
      return { title: "Already working", detail: e.message };
    case "forbidden":
      return {
        title: "Outside the project",
        detail: e.message,
        hint: "Vinnie can only work with files inside the selected project folder.",
      };
    case "blocked":
      return {
        title: "Command blocked",
        detail: e.message,
        hint: "This command is blocked by Vinnie's command policy for your safety.",
      };
    case "permission_denied":
      return { title: "Not permitted", detail: e.message, hint: "You can change permissions in Settings." };
    case "approval_required":
      return { title: "Approval needed", detail: e.message };
    case "conflict":
      return {
        title: "File changed elsewhere",
        detail: e.message,
        hint: "Reload the file to see the latest version, or compare before overwriting.",
      };
    case "tools_unsupported":
      return {
        title: "This model can't use tools",
        detail: e.message,
        hint: "Pick a model with tool support (for example qwen3 or qwen2.5-coder) to let Vinnie search and edit the project.",
      };
    case "no_workspace":
      return { title: "No project folder", detail: e.message };
    default:
      return { title: "Something went wrong", detail: e.message };
  }
}
