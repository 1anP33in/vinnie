import { waitFor } from "@testing-library/react";
import { VinnieError } from "@/lib/errors";
import { installFakes, resetStores } from "@/test/fakes";
import { buildHistory, useChatStore } from "./chatStore";
import { useConnectionStore } from "./connectionStore";
import { toUiMessage, useConversationStore } from "./conversationStore";

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

describe("chat orchestration", () => {
  it("creates a conversation, persists the user message, streams, and persists the reply", async () => {
    expect(await chat().send("  Explain Rust ownership  ")).toBe(true);

    const [conversation] = fakes.conversations.conversations;
    expect(conversation?.title).toBe("Explain Rust ownership");
    expect(convs().activeId).toBe(conversation?.id);
    expect(fakes.conversations.messages.map((m) => m.role)).toEqual(["user"]);

    const stream = fakes.provider.lastStream();
    expect(stream.model).toBe("qwen3:8b");
    expect(stream.messages).toEqual([{ role: "user", content: "Explain Rust ownership" }]);

    stream.emit({ type: "started" });
    stream.emit({ type: "thinking", text: "Let me think" });
    stream.emit({ type: "content", text: "Ownership " });
    stream.emit({ type: "content", text: "means…" });
    await waitFor(() => expect(chat().generation?.content).toBe("Ownership means…"));
    expect(chat().generation?.phase).toBe("streaming");

    stream.complete();
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
    fakes.provider.lastStream().emit({ type: "content", text: "one" });
    fakes.provider.lastStream().complete();
    await waitForGenerationEnd();

    await chat().send("second");
    expect(fakes.provider.lastStream().messages).toEqual([
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
    const stream = fakes.provider.lastStream();
    stream.emit({ type: "content", text: "Once upon" });
    await waitFor(() => expect(chat().generation?.content).toBe("Once upon"));

    await chat().stop();
    expect(stream.cancelled).toBe(true);
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
    const stream = fakes.provider.lastStream();
    stream.emit({ type: "content", text: "Partial" });
    stream.fail(new VinnieError("interrupted", "The connection to Ollama closed early."));
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
    fakes.provider.lastStream().fail(new VinnieError("unreachable", "Could not connect"));
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
    fakes.provider.lastStream().emit({ type: "content", text: "Hi there" });
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
  it("drops empty messages and trailing assistant turns", () => {
    const msg = (id: number, role: "user" | "assistant", content: string) =>
      toUiMessage({
        id,
        conversationId: "c",
        role,
        content,
        thinking: null,
        status: "complete",
        model: null,
        error: null,
        createdAt: id,
      });
    expect(
      buildHistory([msg(1, "user", "a"), msg(2, "assistant", ""), msg(3, "user", "b"), msg(4, "assistant", "partial")]),
    ).toEqual([
      { role: "user", content: "a" },
      { role: "user", content: "b" },
    ]);
  });
});
