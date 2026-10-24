import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VinnieError } from "@/lib/errors";
import { useSettingsStore } from "@/state/settingsStore";
import { installFakes, resetStores } from "@/test/fakes";
import { SettingsView } from "./SettingsView";

let fakes: ReturnType<typeof installFakes>;

beforeEach(async () => {
  resetStores();
  fakes = installFakes();
  await useSettingsStore.getState().load();
});

describe("SettingsView", () => {
  it("validates the endpoint before saving", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const endpoint = screen.getByLabelText("Endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "localhost:11434");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/must start with http/i)).toBeInTheDocument();
    expect(fakes.getStoredSettings().ollamaEndpoint).toBe("http://localhost:11434");
  });

  it("saves valid changes and normalizes them", async () => {
    const user = userEvent.setup();
    render(<SettingsView />);
    const endpoint = screen.getByLabelText("Endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "http://127.0.0.1:11434/");
    await user.click(screen.getByRole("radio", { name: "Light" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText("Settings saved")).toBeInTheDocument();
    expect(fakes.getStoredSettings()).toMatchObject({ ollamaEndpoint: "http://127.0.0.1:11434", theme: "light" });
    expect(useSettingsStore.getState().settings.theme).toBe("light");
  });

  it("tests the connection using the unsaved endpoint", async () => {
    const user = userEvent.setup();
    const check = vi.spyOn(fakes.provider, "checkConnection");
    render(<SettingsView />);
    const endpoint = screen.getByLabelText("Endpoint");
    await user.clear(endpoint);
    await user.type(endpoint, "http://10.0.0.5:11434");
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText(/connected to ollama 0.0.0-test/i)).toBeInTheDocument();
    expect(check).toHaveBeenCalledWith("http://10.0.0.5:11434");
  });

  it("shows a friendly error when the connection test fails", async () => {
    fakes.provider.connectionError = new VinnieError("unreachable", "Could not connect");
    const user = userEvent.setup();
    render(<SettingsView />);
    await user.click(screen.getByRole("button", { name: "Test connection" }));
    expect(await screen.findByText("Can't reach Ollama")).toBeInTheDocument();
  });

  it("requires confirmation to delete all conversations", async () => {
    const { useConversationStore } = await import("@/state/conversationStore");
    await fakes.conversations.create("a", null);
    await useConversationStore.getState().loadList();
    const user = userEvent.setup();
    render(<SettingsView />);
    await user.click(screen.getByRole("button", { name: "Delete all conversations" }));
    const dialog = screen.getByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete all" }));
    await waitFor(() => expect(fakes.conversations.conversations).toHaveLength(0));
    expect(await screen.findByText("Deleted 1 conversation.")).toBeInTheDocument();
  });
});
