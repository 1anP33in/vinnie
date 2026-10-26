import { waitFor } from "@testing-library/react";
import { registerWorkspaceTools } from "@/agent/tools";
import { VinnieError } from "@/lib/errors";
import type { ToolCall } from "@/lib/ipc/types";
import { getServices } from "@/services";
import { installFakes, resetStores } from "@/test/fakes";
import { useActivityStore } from "./activityStore";
import { bridgeAgentEventsToActivity } from "./agentActivityBridge";
import { useApprovalStore } from "./approvalStore";
import { buildHistory, useChatStore } from "./chatStore";
import { useSettingsStore } from "./settingsStore";
import { useConnectionStore } from "./connectionStore";
import { toUiMessage, useConversationStore } from "./conversationStore";
import { useProjectStore } from "./projectStore";

let fakes: ReturnType<typeof installFakes>;

beforeEach(() => {
  resetStores();
  fakes = installFakes();
  useConnectionStore.setState({ selectedModel: "qwen3:8b", status: "connected" });
});

const chat = () => useChatStore.getState();
const convs = () => useConversationStore.getState();

async function waitForGenerationEnd() {
  await waitFor(() => expect(chat().generation).toBeNull());
}

/** Wait until the n-th model request has started, and return it. */
async function stream(n: number) {
  await waitFor(() => expect(fakes.provider.streams).toHaveLength(n));
  return fakes.provider.lastStream();
}

const withoutSystem = (messages: { role: string }[]) => messages.filter((m) => m.role !== "system");

describe("chat orchestration", () => {
  it("creates a conversation, persists the user message, streams, and persists the reply", async () => {
    expect(await chat().send("  Explain Rust ownership  ")).toBe(true);

    const [conversation] = fakes.conversations.conversations;
    expect(conversation?.title).toBe("Explain Rust ownership");
    expect(convs().activeId).toBe(conversation?.id);
    expect(fakes.conversations.messages.map((m) => m.role)).toEqual(["user"]);

    const s = await stream(1);
    expect(s.model).toBe("qwen3:8b");
    expect(s.messages[0]?.role).toBe("system");
    expect(withoutSystem(s.messages)).toEqual([{ role: "user", content: "Explain Rust ownership" }]);

    s.emit({ type: "started" });
    s.emit({ type: "thinking", text: "Let me think" });
    s.emit({ type: "content", text: "Ownership " });
    s.emit({ type: "content", text: "means…" });
    await waitFor(() => expect(chat().generation?.content).toBe("Ownership means…"));
    expect(chat().generation?.phase).toBe("streaming");

    s.complete();
    await waitForGenerationEnd();

    const saved = fakes.conversations.messages;
    expect(saved.map((m) => [m.role, m.content, m.status])).toEqual([
      ["user", "Explain Rust ownership", "complete"],
      ["assistant", "Ownership means…", "complete"],
    ]);
    expect(saved[1]?.thinking).toBe("Let me think");
    expect(saved[1]?.model).toBe("qwen3:8b");
    expect(convs().messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("keeps chronological order across turns and sends the full history", async () => {
    await chat().send("first");
    (await stream(1)).emit({ type: "content", text: "one" });
    fakes.provider.lastStream().complete();
    await waitForGenerationEnd();

    await chat().send("second");
    expect(withoutSystem((await stream(2)).messages)).toEqual([
      { role: "user", content: "first" },
      { role: "assistant", content: "one" },
      { role: "user", content: "second" },
    ]);
    fakes.provider.lastStream().emit({ type: "content", text: "two" });
    fakes.provider.lastStream().complete();
    await waitForGenerationEnd();

    expect(convs().messages.map((m) => m.content)).toEqual(["first", "one", "second", "two"]);
    expect(fakes.conversations.conversations).toHaveLength(1);
  });

  it("rejects duplicate submissions while a request is in flight", async () => {
    const first = chat().send("hello");
    const second = chat().send("hello again");
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    expect(fakes.conversations.messages.filter((m) => m.role === "user")).toHaveLength(1);
    await stream(1);
    expect(fakes.provider.streams).toHaveLength(1);
  });

  it("ignores empty messages and requires a model", async () => {
    expect(await chat().send("   ")).toBe(false);
    useConnectionStore.setState({ selectedModel: null });
    expect(await chat().send("hi")).toBe(false);
    expect(chat().error?.error.message).toMatch(/choose a model/i);
    expect(fakes.conversations.messages).toHaveLength(0);
  });

  it("stops generation and keeps the partial response marked interrupted", async () => {
    await chat().send("write a story");
    const s = await stream(1);
    s.emit({ type: "content", text: "Once upon" });
    await waitFor(() => expect(chat().generation?.content).toBe("Once upon"));

    await chat().stop();
    expect(s.cancelled).toBe(true);
    await waitForGenerationEnd();

    const reply = fakes.conversations.messages.at(-1);
    expect(reply?.role).toBe("assistant");
    expect(reply?.content).toBe("Once upon");
    expect(reply?.status).toBe("interrupted");
    expect(chat().error).toBeNull();
  });

  it("does not save anything when stopped before any output", async () => {
    await chat().send("hi");
    await chat().stop();
    await waitForGenerationEnd();
    expect(fakes.conversations.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("surfaces generation errors with retry, preserving partial output", async () => {
    await chat().send("hi");
    const s = await stream(1);
    s.emit({ type: "content", text: "Partial" });
    s.fail(new VinnieError("interrupted", "The connection to Ollama closed early."));
    await waitForGenerationEnd();

    expect(chat().error?.error.kind).toBe("interrupted");
    expect(chat().error?.canRetry).toBe(true);
    const reply = fakes.conversations.messages.at(-1);
    expect(reply?.status).toBe("interrupted");
    expect(reply?.error).toMatch(/closed early/);

    // Retry regenerates for the last user message, ignoring the partial reply.
    await chat().retry();
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(2));
    const retry = fakes.provider.lastStream();
    expect(retry.messages.at(-1)).toEqual({ role: "user", content: "hi" });
    retry.emit({ type: "content", text: "Full answer" });
    retry.complete();
    await waitForGenerationEnd();
    expect(fakes.conversations.messages.at(-1)?.content).toBe("Full answer");
    expect(chat().error).toBeNull();
  });

  it("reports errors without output and saves nothing extra", async () => {
    await chat().send("hi");
    (await stream(1)).fail(new VinnieError("unreachable", "Could not connect"));
    await waitForGenerationEnd();
    expect(chat().error?.error.kind).toBe("unreachable");
    expect(fakes.conversations.messages.map((m) => m.role)).toEqual(["user"]);
  });

  it("never claims a user message was saved when persistence fails", async () => {
    fakes.conversations.failAddMessage = (m) => m.role === "user";
    expect(await chat().send("hello")).toBe(false);
    expect(chat().error?.error.kind).toBe("database");
    expect(chat().generation).toBeNull();
    expect(fakes.provider.streams).toHaveLength(0);
    // The empty conversation created for it is cleaned up.
    await waitFor(() => expect(fakes.conversations.conversations).toHaveLength(0));
  });

  it("marks an assistant reply as unsaved when persistence fails, and can retry the save", async () => {
    fakes.conversations.failAddMessage = (m) => m.role === "assistant";
    await chat().send("hello");
    (await stream(1)).emit({ type: "content", text: "Hi there" });
    fakes.provider.lastStream().complete();
    await waitForGenerationEnd();

    const shown = convs().messages.at(-1)!;
    expect(shown.unsaved).toBe(true);
    expect(shown.saveError).toMatch(/disk/);
    expect(fakes.conversations.messages.map((m) => m.role)).toEqual(["user"]);

    fakes.conversations.failAddMessage = null;
    await chat().retrySave(shown.localId);
    expect(convs().messages.at(-1)?.unsaved).toBeUndefined();
    expect(fakes.conversations.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
  });
});

describe("buildHistory", () => {
  const msg = (
    id: number,
    role: "user" | "assistant" | "tool",
    content: string,
    extra: Partial<{ toolCalls: ToolCall[]; toolName: string }> = {},
  ) =>
    toUiMessage({
      id,
      conversationId: "c",
      role,
      content,
      thinking: null,
      status: "complete",
      model: null,
      error: null,
      toolCalls: extra.toolCalls ?? null,
      toolName: extra.toolName ?? null,
      createdAt: id,
    });

  it("drops empty messages and trailing assistant turns", () => {
    expect(
      buildHistory([msg(1, "user", "a"), msg(2, "assistant", ""), msg(3, "user", "b"), msg(4, "assistant", "partial")]),
    ).toEqual([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
  });

  it("keeps tool calls and tool results from earlier turns", () => {
    const call: ToolCall = { function: { name: "search_files", arguments: { query: "duty" } } };
    expect(
      buildHistory([
        msg(1, "user", "find duty"),
        msg(2, "assistant", "", { toolCalls: [call] }),
        msg(3, "tool", "client/main.lua:1", { toolName: "search_files" }),
        msg(4, "assistant", "It is in client/main.lua"),
        msg(5, "user", "thanks"),
      ]),
    ).toEqual([
      { role: "user", content: "find duty" },
      { role: "assistant", content: "", tool_calls: [call] },
      { role: "tool", content: "client/main.lua:1", tool_name: "search_files" },
      { role: "assistant", content: "It is in client/main.lua" },
      { role: "user", content: "thanks" },
    ]);
  });
});

describe("tool use", () => {
  beforeEach(() => {
    bridgeAgentEventsToActivity();
    registerWorkspaceTools(getServices().tools);
    useProjectStore.setState({ project: { path: "C:\\Projects\\demo", name: "demo", status: "available" } });
    fakes.ws.files.set("client/main.lua", "RegisterCommand('duty', function() end)\n");
  });

  it("offers tools, runs the requested tool, and sends the result back to the model", async () => {
    await chat().send("Which file handles the duty command?");
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(1));
    const first = fakes.provider.lastStream();
    expect(first.tools?.length).toBeGreaterThan(0);
    expect(first.messages[0]?.role).toBe("system");
    expect(first.messages[0]?.content).toContain("Project: demo");

    first.callTool("search_files", { query: "RegisterCommand" });
    first.complete();

    await waitFor(() => expect(fakes.provider.streams).toHaveLength(2));
    const second = fakes.provider.lastStream();
    const toolTurn = second.messages.at(-1)!;
    expect(toolTurn.role).toBe("tool");
    expect(toolTurn.tool_name).toBe("search_files");
    expect(toolTurn.content).toContain("client/main.lua:1");
    expect(second.messages.at(-2)?.tool_calls?.[0]?.function.name).toBe("search_files");

    second.emit({ type: "content", text: "It's registered in client/main.lua." });
    second.complete();
    await waitForGenerationEnd();

    // The app (not the model) appends a task report because tools ran.
    expect(fakes.conversations.messages.map((m) => m.role)).toEqual(["user", "assistant", "tool", "assistant", "assistant"]);
    expect(fakes.conversations.messages.at(-1)).toMatchObject({ model: null, content: expect.stringContaining("Task report") });
    expect(fakes.conversations.messages[1]?.toolCalls?.[0]?.function.name).toBe("search_files");
    expect(fakes.conversations.messages[2]?.toolName).toBe("search_files");
    expect(useActivityStore.getState().activities.some((a) => a.title.startsWith('Searching project for "RegisterCommand"'))).toBe(true);
  });

  it("falls back to plain chat when the model does not support tools", async () => {
    await chat().send("hello");
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(1));
    fakes.provider.lastStream().fail(new VinnieError("tools_unsupported", "gemma does not support tools"));
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(2));
    expect(fakes.provider.lastStream().tools).toBeUndefined();
    expect(chat().notice).toMatch(/doesn't support tools/);
    fakes.provider.lastStream().emit({ type: "content", text: "Hi!" });
    fakes.provider.lastStream().complete();
    await waitForGenerationEnd();
    expect(chat().error).toBeNull();
  });

  it("does not offer tools without a project", async () => {
    useProjectStore.setState({ project: null });
    await chat().send("hello");
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(1));
    expect(fakes.provider.lastStream().tools).toBeUndefined();
    expect(fakes.provider.lastStream().messages[0]?.content).toContain("No project folder is selected");
  });

  it("stops at the iteration limit and reports it honestly", async () => {
    const settings = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...settings, agent: { ...settings.agent, maxIterations: 3 } } });
    await chat().send("Look at the project structure again and again");
    for (let i = 0; i < 3; i++) {
      const s = await stream(i + 1);
      s.callTool("get_project_structure", { depth: i + 1 });
      s.complete();
    }
    await waitForGenerationEnd();
    expect(fakes.provider.streams).toHaveLength(3);
    const report = fakes.conversations.messages.at(-1)!;
    expect(report.content).toContain("Task report");
    expect(report.content).toMatch(/iteration limit/i);
  });

  it("stopping denies pending approvals", async () => {
    fakes.ws.files.set("a.lua", "x");
    await chat().send("edit a.lua");
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(1));
    const s = fakes.provider.lastStream();
    s.callTool("write_file", { path: "a.lua", content: "y" });
    s.complete();
    await waitFor(() => expect(useApprovalStore.getState().pending).toHaveLength(1));
    await chat().stop();
    await waitForGenerationEnd();
    expect(fakes.ws.files.get("a.lua")).toBe("x");
    expect(useApprovalStore.getState().pending).toHaveLength(0);
  });
});
