import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConversationStore } from "@/state/conversationStore";
import { installFakes, resetStores } from "@/test/fakes";
import { ConversationList } from "./ConversationList";

let fakes: ReturnType<typeof installFakes>;

beforeEach(async () => {
  resetStores();
  fakes = installFakes();
  const now = Date.now();
  fakes.conversations.conversations.push(
    { id: "c1", title: "Today chat", model: null, createdAt: now, updatedAt: now, messageCount: 0 },
    {
      id: "c2",
      title: "Old chat",
      model: null,
      createdAt: now - 40 * 86_400_000,
      updatedAt: now - 40 * 86_400_000,
      messageCount: 0,
    },
  );
  await useConversationStore.getState().loadList();
});

describe("ConversationList", () => {
  it("groups conversations by date", () => {
    render(<ConversationList />);
    const today = screen.getByRole("region", { name: "Today" });
    expect(within(today).getByText("Today chat")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Yesterday" })).not.toBeInTheDocument();
    expect(screen.getByText("Old chat")).toBeInTheDocument();
  });

  it("opens a conversation on click", async () => {
    const user = userEvent.setup();
    render(<ConversationList />);
    await user.click(screen.getByText("Today chat"));
    expect(useConversationStore.getState().activeId).toBe("c1");
  });

  it("asks for confirmation before deleting", async () => {
    const user = userEvent.setup();
    render(<ConversationList />);
    await user.click(screen.getByRole("button", { name: "Delete Today chat" }));
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toHaveTextContent("Today chat");

    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(fakes.conversations.conversations).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Delete Today chat" }));
    await user.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Today chat")).not.toBeInTheDocument());
    expect(fakes.conversations.conversations.map((c) => c.id)).toEqual(["c2"]);
  });

  it("renames inline", async () => {
    const user = userEvent.setup();
    render(<ConversationList />);
    await user.click(screen.getByRole("button", { name: "Rename Today chat" }));
    const input = screen.getByLabelText("Conversation title");
    await user.clear(input);
    await user.type(input, "Renamed{Enter}");
    expect(await screen.findByText("Renamed")).toBeInTheDocument();
    expect(fakes.conversations.conversations[0]?.title).toBe("Renamed");
  });

  it("shows an empty state for searches without matches", async () => {
    await useConversationStore.getState().search("zzz");
    render(<ConversationList />);
    expect(screen.getByText(/no conversations match/i)).toBeInTheDocument();
  });
});
