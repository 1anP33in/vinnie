// Verification engine: checks the agent's work independently of the model.
// A file written successfully is not a task completed; the engine re-reads
// changed files, validates configs and FiveM manifests, and runs the
// project's own typecheck/lint/test/build commands when they exist.

import { toVinnieError } from "@/lib/errors";
import type { ProjectMetadata, RunResult } from "@/lib/ipc/types";
import type { Services } from "@/services";
import type { TaskChange, VerificationCheck, VerificationResult } from "./types";

const CODE_EXTENSIONS = new Set([
  "js", "mjs", "cjs", "jsx", "ts", "tsx", "mts", "cts", "vue", "svelte", "py", "rs", "go", "cs", "lua", "java", "kt",
  "json", "toml", "yaml", "yml",
]);
const MAX_COMMAND_CHECKS = 3;
const NODE_SCRIPT_ORDER = ["typecheck", "lint", "test", "build"];
const NPM_PLACEHOLDER_TEST = /no test specified/i;

export interface VerificationDeps {
  services: Services;
  metadata(): ProjectMetadata | null;
  /** Re-analyze the project (after changes) when possible. */
  refreshMetadata(): Promise<ProjectMetadata | null>;
  /** Run a verification command under the normal policy/approval rules. */
  runCheck(command: string): Promise<{ result?: RunResult; skipped?: string }>;
  signal: AbortSignal;
}

let checkCounter = 0;
const checkId = () => `check-${(checkCounter++).toString(36)}`;

const extOf = (path: string) => (path.includes(".") ? path.split(".").pop()!.toLowerCase() : "");

/** Final state per path (the last change to a path wins). */
export function finalChanges(changes: TaskChange[]): TaskChange[] {
  const byPath = new Map<string, TaskChange>();
  for (const c of changes) {
    if (c.kind === "move") {
      byPath.delete(c.path);
      byPath.set(c.newPath ?? c.path, c);
    } else {
      byPath.set(c.path, c);
    }
  }
  return [...byPath.values()];
}

/** Strip // and /* *\/ comments so tsconfig-style JSONC can be parsed. */
function stripJsonComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'])\/\/.*$/gm, "$1");
}

/** Commands that check the project, chosen from what the project defines. */
export async function chooseCommands(
  services: Services,
  metadata: ProjectMetadata | null,
): Promise<string[]> {
  const commands: string[] = [];
  const managers = metadata?.packageManagers ?? [];
  const node = managers.find((m) => m.ecosystem === "node");
  if (node) {
    try {
      const pkg = await services.workspace.readFile("package.json");
      const scripts = (JSON.parse(pkg.content ?? "{}").scripts ?? {}) as Record<string, string>;
      const pm = node.ambiguous ? "npm" : (node.manager ?? "npm");
      for (const name of NODE_SCRIPT_ORDER) {
        if (commands.length >= MAX_COMMAND_CHECKS) break;
        const script = scripts[name];
        if (!script || (name === "test" && NPM_PLACEHOLDER_TEST.test(script))) continue;
        // Only run a full build when there is nothing lighter to run.
        if (name === "build" && commands.length > 0) continue;
        commands.push(name === "test" ? `${pm} test` : `${pm} run ${name}`);
      }
    } catch {
      /* no readable package.json: no node checks */
    }
  }
  if (managers.some((m) => m.ecosystem === "rust")) commands.push("cargo check");
  if (managers.some((m) => m.ecosystem === "go")) commands.push("go build ./...");
  if (managers.some((m) => m.ecosystem === "dotNet")) commands.push("dotnet build");
  if (metadata?.frameworks.includes("pytest")) commands.push("python -m pytest -q");
  return commands.slice(0, MAX_COMMAND_CHECKS);
}

export class VerificationEngine {
  constructor(private readonly deps: VerificationDeps) {}

  private async fileChecks(changes: TaskChange[]): Promise<VerificationCheck[]> {
    const checks: VerificationCheck[] = [];
    for (const c of finalChanges(changes)) {
      const path = c.kind === "move" ? (c.newPath ?? c.path) : c.path;
      try {
        const file = await this.deps.services.workspace.readFile(path);
        if (c.kind === "delete") {
          checks.push({ id: checkId(), name: `${path} was deleted`, kind: "file", status: "failed", details: "The file still exists." });
          continue;
        }
        if (c.expectedContent !== undefined && file.content !== null && file.content !== c.expectedContent) {
          checks.push({
            id: checkId(),
            name: `${path} has the written content`,
            kind: "file",
            status: "failed",
            details: "The file on disk differs from what Vinnie wrote (it may have been changed afterwards).",
          });
        } else {
          checks.push({ id: checkId(), name: `${path} exists`, kind: "file", status: "passed", details: "File present with the expected content." });
        }
        if (["json", "jsonc"].includes(extOf(path)) && file.content != null) {
          try {
            JSON.parse(extOf(path) === "jsonc" || /tsconfig|jsconfig/i.test(path) ? stripJsonComments(file.content) : file.content);
            checks.push({ id: checkId(), name: `${path} is valid JSON`, kind: "config", status: "passed", details: "Parsed successfully." });
          } catch (err) {
            checks.push({
              id: checkId(),
              name: `${path} is valid JSON`,
              kind: "config",
              status: "failed",
              details: err instanceof Error ? err.message : "Invalid JSON.",
            });
          }
        }
      } catch (err) {
        const e = toVinnieError(err);
        if (c.kind === "delete" && e.kind === "not_found") {
          checks.push({ id: checkId(), name: `${path} was deleted`, kind: "file", status: "passed", details: "The file no longer exists." });
        } else {
          checks.push({ id: checkId(), name: `${path} exists`, kind: "file", status: "failed", details: e.message });
        }
      }
    }
    return checks;
  }

  private async manifestChecks(metadata: ProjectMetadata | null): Promise<VerificationCheck[]> {
    const m = metadata?.fivem;
    if (!m) return [];
    const referenced = [...m.clientScripts, ...m.serverScripts, ...m.sharedScripts, ...m.files, ...(m.uiPage ? [m.uiPage] : [])]
      .filter((p) => !p.startsWith("@") && !p.includes("*"));
    const missing: string[] = [];
    for (const path of [...new Set(referenced)]) {
      try {
        await this.deps.services.workspace.statFile(path);
      } catch {
        missing.push(path);
      }
    }
    return [
      {
        id: checkId(),
        name: `${m.manifestFile} references existing files`,
        kind: "manifest",
        status: missing.length ? "failed" : "passed",
        details: missing.length
          ? `Missing: ${missing.join(", ")}`
          : `${referenced.length} referenced file(s) found. (This does not test the resource in-game.)`,
      },
    ];
  }

  private async commandChecks(commands: string[]): Promise<VerificationCheck[]> {
    const checks: VerificationCheck[] = [];
    for (const command of commands) {
      if (this.deps.signal.aborted) break;
      const started = Date.now();
      const { result, skipped } = await this.deps.runCheck(command);
      if (!result) {
        checks.push({ id: checkId(), name: command, kind: "command", status: "skipped", details: skipped ?? "Not run.", command });
        continue;
      }
      const o = result.outcome;
      checks.push({
        id: checkId(),
        name: command,
        kind: "command",
        status: o.success ? "passed" : o.cancelled ? "skipped" : "failed",
        details: o.success
          ? `Exit code 0 in ${(o.durationMs / 1000).toFixed(1)}s.`
          : o.timedOut
            ? "Timed out and was stopped."
            : o.cancelled
              ? "Stopped."
              : `Exit code ${o.exitCode ?? "none"}.\n${(o.stderrTail || o.stdoutTail).trim().slice(-1_500)}`,
        command,
        exitCode: o.exitCode,
        durationMs: Date.now() - started,
      });
    }
    return checks;
  }

  async verify(changes: TaskChange[]): Promise<VerificationResult> {
    const touched = finalChanges(changes);
    const codeChanged = touched.some((c) => CODE_EXTENSIONS.has(extOf(c.newPath ?? c.path)));
    const checks: VerificationCheck[] = [...(await this.fileChecks(changes))];

    let metadata = this.deps.metadata();
    if (codeChanged) metadata = (await this.deps.refreshMetadata()) ?? metadata;
    const fivemTouched = touched.some((c) => /\.lua$|fxmanifest\.lua$|__resource\.lua$/i.test(c.newPath ?? c.path));
    if (fivemTouched) checks.push(...(await this.manifestChecks(metadata)));
    if (codeChanged && !this.deps.signal.aborted) {
      checks.push(...(await this.commandChecks(await chooseCommands(this.deps.services, metadata))));
    }

    const failed = checks.filter((c) => c.status === "failed");
    const passed = checks.filter((c) => c.status === "passed");
    const ran = checks.filter((c) => c.status !== "skipped");
    const success = failed.length === 0;
    const summary =
      ran.length === 0
        ? "Nothing could be verified automatically."
        : success
          ? `All ${passed.length} check${passed.length === 1 ? "" : "s"} passed.`
          : `${failed.length} of ${ran.length} checks failed: ${failed.map((f) => f.name).join("; ")}.`;
    return { success, checks, summary };
  }
}

/** Text given to the model after a failed verification so it can repair. */
export function describeVerificationFailure(result: VerificationResult): string {
  const lines = result.checks
    .filter((c) => c.status === "failed")
    .map((c) => `- ${c.name}: ${c.details}`);
  return `Automatic verification failed (${result.summary})\n${lines.join("\n")}\nFix these problems with tools, then reply when done.`;
}
