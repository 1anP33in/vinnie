import { installFakes, resetStores } from "@/test/fakes";
import { useConversationStore } from "./conversationStore";

let fakes: ReturnType<typeof installFakes>;
const store = () => useConversationStore.getState();

beforeEach(() => {
  resetStores();
  fakes = installFakes();
});

describe("conversation store", () => {
  it("creates, lists most-recent first, and remembers the active conversation", async () => {
    await store().create("First", null);
    const second = await store().create("Second", "m");
    await store().loadList();
    expect(store().conversations.map((c) => c.title)).toEqual(["Second", "First"]);
    expect(store().activeId).toBe(second.id);
    await vi.waitFor(() => expect(fakes.conversations.lastActive).toBe(second.id));
  });

  it("opens a conversation and loads its messages in order", async () => {
    const c = await fakes.conversations.create("Chat", null);
    await fakes.conversations.addMessage({ conversationId: c.id, role: "user", content: "1" });
    await fakes.conversations.addMessage({ conversationId: c.id, role: "assistant", content: "2" });
    await store().open(c.id);
    expect(store().messagesStatus).toBe("loaded");
    expect(store().messages.map((m) => m.content)).toEqual(["1", "2"]);
  });

  it("reports a missing conversation when opening fails", async () => {
    await store().open("does-not-exist");
    // The fake returns [] for unknown ids; simulate the backend's not-found instead.
    fakes.conversations.listMessages = async () => {
      throw { kind: "not_found", message: "That conversation no longer exists." };
    };
    await store().open("does-not-exist");
    expect(store().messagesStatus).toBe("error");
    expect(store().messagesError?.kind).toBe("not_found");
  });

  it("renames and deletes, resetting the view when the active one is deleted", async () => {
    const c = await store().create("Old", null);
    expect(await store().rename(c.id, "New")).toBe(true);
    expect(store().conversations[0]?.title).toBe("New");
    expect(await store().remove(c.id)).toBe(true);
    expect(store().conversations).toEqual([]);
    expect(store().activeId).toBeNull();
  });

  it("records an action error when deletion fails", async () => {
    expect(await store().remove("missing")).toBe(false);
    expect(store().actionError?.kind).toBe("not_found");
  });

  it("searches titles and content, and clears results for blank queries", async () => {
    const a = await fakes.conversations.create("Rust lifetimes", null);
    const b = await fakes.conversations.create("Groceries", null);
    await fakes.conversations.addMessage({ conversationId: b.id, role: "user", content: "buy rust remover" });
    await store().search("RUST");
    expect(store().results?.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    await store().search("  ");
    expect(store().results).toBeNull();
  });

  it("deletes all conversations", async () => {
    await store().create("a", null);
    await store().create("b", null);
    expect(await store().removeAll()).toBe(2);
    expect(store().conversations).toEqual([]);
  });
});
