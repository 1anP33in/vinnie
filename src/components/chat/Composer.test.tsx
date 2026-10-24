import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useChatStore } from "@/state/chatStore";
import { useConnectionStore } from "@/state/connectionStore";
import { installFakes, resetStores } from "@/test/fakes";
import { Composer } from "./Composer";

let fakes: ReturnType<typeof installFakes>;

beforeEach(() => {
  resetStores();
  fakes = installFakes();
  useConnectionStore.setState({ selectedModel: "qwen3:8b", status: "connected" });
});

describe("Composer", () => {
  it("sends on Enter and clears the input", async () => {
    const user = userEvent.setup();
    render(<Composer />);
    const input = screen.getByLabelText("Message");
    await user.type(input, "Hello Vinnie{Enter}");
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(1));
    expect(fakes.conversations.messages[0]?.content).toBe("Hello Vinnie");
    expect(input).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    render(<Composer />);
    const input = screen.getByLabelText("Message");
    await user.type(input, "line one{Shift>}{Enter}{/Shift}line two");
    expect(input).toHaveValue("line one\nline two");
    expect(fakes.provider.streams).toHaveLength(0);
  });

  it("disables send for empty input and without a model", async () => {
    const user = userEvent.setup();
    render(<Composer />);
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    await user.type(screen.getByLabelText("Message"), "hi");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();

    useConnectionStore.setState({ selectedModel: null });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled());
    expect(screen.getByLabelText("Message")).toHaveAttribute("placeholder", expect.stringMatching(/select an installed model/i));
  });

  it("shows a stop button while generating, which cancels the stream", async () => {
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(screen.getByLabelText("Message"), "tell me a story{Enter}");
    const stop = await screen.findByRole("button", { name: "Stop generating" });
    expect(screen.queryByRole("button", { name: "Send message" })).not.toBeInTheDocument();
    await waitFor(() => expect(fakes.provider.streams).toHaveLength(1));

    await user.click(stop);
    expect(fakes.provider.lastStream().cancelled).toBe(true);
    await waitFor(() => expect(useChatStore.getState().generation).toBeNull());
    expect(screen.getByRole("button", { name: "Send message" })).toBeInTheDocument();
  });

  it("restores the draft if the message could not be saved", async () => {
    fakes.conversations.failAddMessage = () => true;
    const user = userEvent.setup();
    render(<Composer />);
    await user.type(screen.getByLabelText("Message"), "important text{Enter}");
    await waitFor(() => expect(screen.getByLabelText("Message")).toHaveValue("important text"));
    expect(useChatStore.getState().error?.error.kind).toBe("database");
  });
});
