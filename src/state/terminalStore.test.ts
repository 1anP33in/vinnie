import { installFakes, resetStores } from "@/test/fakes";
import { appendOutput, useTerminalStore, type TerminalRun } from "./terminalStore";

type Out = Pick<TerminalRun, "lines" | "openLine" | "droppedLines">;
const empty: Out = { lines: [], openLine: false, droppedLines: 0 };
const text = (o: Out) => o.lines.map((l) => l.text);

describe("appendOutput", () => {
  it("splits lines and joins chunks split mid-line", () => {
    let o = appendOutput(empty, "stdout", "added 42 ");
    o = appendOutput(o, "stdout", "packages\nok\n");
    expect(text(o)).toEqual(["added 42 packages", "ok"]);
    expect(o.openLine).toBe(false);
  });

  it("normalizes CRLF and rewrites lines on bare carriage returns (progress bars)", () => {
    let o = appendOutput(empty, "stdout", "line1\r\nprogress 10%");
    o = appendOutput(o, "stdout", "\rprogress 50%");
    o = appendOutput(o, "stdout", "\rprogress 100%\ndone\n");
    expect(text(o)).toEqual(["line1", "progress 100%", "done"]);
  });

  it("keeps blank lines and stream kinds", () => {
    let o = appendOutput(empty, "stdout", "a\n\n");
    o = appendOutput(o, "stderr", "boom\n");
    expect(text(o)).toEqual(["a", "", "boom"]);
    expect(o.lines[2]?.stream).toBe("stderr");
  });

  it("drops the oldest lines beyond the limit", () => {
    const o = appendOutput(empty, "stdout", "x\n".repeat(5_010));
    expect(o.lines).toHaveLength(5_000);
    expect(o.droppedLines).toBe(10);
  });
});

describe("terminal store", () => {
  let fakes: ReturnType<typeof installFakes>;
  beforeEach(() => {
    resetStores();
    fakes = installFakes();
  });
  const runs = () => useTerminalStore.getState().runs;

  it("records successful runs with exit code and duration", async () => {
    fakes.process.outcomes.set("npm install", { exitCode: 0, stdout: "added 42 packages\n", durationMs: 3400 });
    const result = await useTerminalStore.getState().run({ command: "npm install", actor: "user" });
    expect(result.outcome.exitCode).toBe(0);
    expect(runs()[0]).toMatchObject({ status: "succeeded", exitCode: 0, durationMs: 3400, actor: "user" });
    await vi.waitFor(() => expect(runs()[0]?.lines.map((l) => l.text)).toEqual(["added 42 packages"]));
    expect(useTerminalStore.getState().history).toEqual(["npm install"]);
  });

  it("diagnoses failures", async () => {
    fakes.process.outcomes.set("npm test", { exitCode: 1, stderr: "Error: Cannot find module 'express'\n" });
    await useTerminalStore.getState().run({ command: "npm test", actor: "user" });
    expect(runs()[0]?.status).toBe("failed");
    expect(runs()[0]?.diagnosis?.missingPackages).toEqual(["express"]);
  });

  it("marks blocked commands as not run", async () => {
    fakes.process.requirements.set("del /q *", "blocked");
    await expect(useTerminalStore.getState().run({ command: "del /q *", actor: "user" })).rejects.toMatchObject({
      kind: "blocked",
    });
    expect(runs()[0]).toMatchObject({ status: "rejected" });
    expect(fakes.process.runs).toHaveLength(0);
  });

  it("reports timeouts and cancellation", async () => {
    fakes.process.outcomes.set("npm run dev", { exitCode: null, timedOut: true, success: false });
    await useTerminalStore.getState().run({ command: "npm run dev", actor: "user" });
    expect(runs()[0]?.status).toBe("timedOut");
    fakes.process.outcomes.set("npm start", { exitCode: null, cancelled: true, success: false });
    await useTerminalStore.getState().run({ command: "npm start", actor: "user" });
    expect(runs()[1]?.status).toBe("cancelled");
  });
});
