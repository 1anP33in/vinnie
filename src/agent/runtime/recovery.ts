// Failure classification and recovery guidance. The runtime uses the
// category to decide what to tell the model and whether a retry is useful;
// it never blindly retries.

import type { Diagnosis } from "@/lib/diagnose";

export type FailureCode =
  | "FILE_NOT_FOUND"
  | "PERMISSION_DENIED"
  | "INVALID_ARGUMENT"
  | "COMMAND_FAILED"
  | "COMMAND_TIMEOUT"
  | "DEPENDENCY_FAILURE"
  | "NETWORK_FAILURE"
  | "MODEL_FAILURE"
  | "TOOL_FAILURE"
  | "VALIDATION_FAILURE"
  | "CANCELLED"
  | "UNKNOWN";

/** Map an application error kind (from the backend or tools) to a failure code. */
export function classifyErrorKind(kind: string | undefined): FailureCode {
  switch (kind) {
    case "not_found":
      return "FILE_NOT_FOUND";
    case "permission_denied":
    case "approval_required":
    case "denied":
    case "blocked":
      return "PERMISSION_DENIED";
    case "validation":
    case "invalid_input":
    case "forbidden":
      return "INVALID_ARGUMENT";
    case "timeout":
      return "COMMAND_TIMEOUT";
    case "unreachable":
    case "interrupted":
      return "NETWORK_FAILURE";
    case "malformed":
    case "model_not_found":
    case "tools_unsupported":
      return "MODEL_FAILURE";
    case "conflict":
    case "unknown_tool":
    case "io":
    case "internal":
      return "TOOL_FAILURE";
    case "cancelled":
      return "CANCELLED";
    default:
      return "UNKNOWN";
  }
}

/** Errors worth retrying the same model request for (transient). */
export function isTransientModelError(kind: string | undefined): boolean {
  return kind === "interrupted" || kind === "timeout" || kind === "malformed";
}

/** Guidance appended to a failed tool result so the model can adapt. */
export function recoveryHint(code: FailureCode, diagnosis: Diagnosis | null = null): string {
  switch (code) {
    case "FILE_NOT_FOUND":
      return "The path does not exist. Use search_files with mode \"filename\" to find where it is, or get_project_structure.";
    case "PERMISSION_DENIED":
      return "This action was not permitted (denied by the user, the permission settings, or the command policy). Do not retry it; continue without it, choose a different approach, or explain what you need.";
    case "INVALID_ARGUMENT":
      return "Fix the arguments: they must match the tool's schema, and paths must be relative and stay inside the project.";
    case "COMMAND_TIMEOUT":
      return "The process ran too long and was stopped. Run a narrower command, or pass a larger timeoutSeconds if it genuinely needs more time.";
    case "COMMAND_FAILED":
      if (diagnosis?.missingPackages.length) {
        return `A dependency appears to be missing (${diagnosis.missingPackages.join(", ")}). Check the project's manifest (e.g. package.json), then use install_dependency if it is really missing.`;
      }
      return diagnosis
        ? `Likely cause: ${diagnosis.cause} ${diagnosis.suggestion} Fix the cause before running the same command again.`
        : "Read the error output to find the cause, and change something before running the same command again.";
    case "DEPENDENCY_FAILURE":
      return "Installing the dependency failed. Check the package name and the error output; do not assume it was installed.";
    case "NETWORK_FAILURE":
      return "A network or connection problem occurred. It may succeed later; avoid repeating it immediately.";
    case "TOOL_FAILURE":
      return "The tool could not complete. Check the error and try a different approach.";
    case "VALIDATION_FAILURE":
      return "Verification found a problem. Fix it, then finish again.";
    default:
      return "Review the error before deciding what to do next.";
  }
}

/** Stable signature of a tool call, to detect identical repeats. */
export function callSignature(name: string, args: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.keys(v as Record<string, unknown>)
          .sort()
          .map((k) => [k, sort((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return `${name}:${JSON.stringify(sort(args ?? {}))}`;
}

/**
 * Tracks failed calls so the same failing operation is not repeated without
 * a change. A call that already failed `maxRetries + 1` times is refused.
 */
export class RetryGuard {
  private failures = new Map<string, number>();

  constructor(private readonly maxRetries: number) {}

  /** Whether this exact call may run again. */
  allows(signature: string): boolean {
    return (this.failures.get(signature) ?? 0) <= this.maxRetries;
  }

  failureCount(signature: string): number {
    return this.failures.get(signature) ?? 0;
  }

  recordFailure(signature: string): number {
    const n = (this.failures.get(signature) ?? 0) + 1;
    this.failures.set(signature, n);
    return n;
  }

  /** A success means the situation changed; forget earlier failures of that call. */
  recordSuccess(signature: string): void {
    this.failures.delete(signature);
  }
}
