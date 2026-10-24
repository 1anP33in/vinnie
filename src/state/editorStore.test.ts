import { installFakes, resetStores } from "@/test/fakes";
import { useEditorStore, type FileTab } from "./editorStore";

let fakes: ReturnType<typeof installFakes>;
const editor = () => useEditorStore.getState();
const tab = (path: string) => editor().tabs.find((t): t is FileTab => t.kind === "file" && t.path === path)!;

beforeEach(async () => {
  resetStores();
  fakes = installFakes();
  fakes.ws.files.set("client/main.lua", "print('a')\n");
  await editor().openFile("client/main.lua");
});

describe("editor store", () => {
  it("opens files once and tracks saved/modified state", async () => {
    await editor().openFile("client/main.lua");
    expect(editor().tabs).toHaveLength(1);
    expect(tab("client/main.lua").status).toBe("saved");
    editor().setDraft("client/main.lua", "print('b')\n");
    expect(tab("client/main.lua").status).toBe("modified");
    editor().setDraft("client/main.lua", "print('a')\n");
    expect(tab("client/main.lua").status).toBe("saved");
  });

  it("saves through the change manager with the expected version", async () => {
    editor().setDraft("client/main.lua", "print('b')\n");
    expect(await editor().save("client/main.lua")).toBe(true);
    expect(fakes.ws.files.get("client/main.lua")).toBe("print('b')\n");
    expect(tab("client/main.lua").status).toBe("saved");
    expect(fakes.ws.changes[0]).toMatchObject({ source: "user", kind: "modify" });
  });

  it("reloads clean tabs silently when the file changes on disk", async () => {
    fakes.ws.files.set("client/main.lua", "print('external')\n");
    await editor().checkExternal();
    expect(tab("client/main.lua").draft).toBe("print('external')\n");
    expect(tab("client/main.lua").status).toBe("saved");
  });

  it("never overwrites unsaved edits when the file changes on disk", async () => {
    editor().setDraft("client/main.lua", "my edits\n");
    fakes.ws.files.set("client/main.lua", "print('external')\n");
    await editor().checkExternal();
    const t = tab("client/main.lua");
    expect(t.status).toBe("external");
    expect(t.draft).toBe("my edits\n");

    // A normal save is refused because the disk version changed.
    expect(await editor().save("client/main.lua")).toBe(false);
    expect(fakes.ws.files.get("client/main.lua")).toBe("print('external')\n");

    // The user can explicitly overwrite.
    expect(await editor().save("client/main.lua", true)).toBe(true);
    expect(fakes.ws.files.get("client/main.lua")).toBe("my edits\n");
  });

  it("detects deleted files", async () => {
    fakes.ws.files.delete("client/main.lua");
    await editor().checkExternal();
    expect(tab("client/main.lua").status).toBe("deleted");
  });

  it("marks binary files", async () => {
    fakes.ws.files.set("logo.png", "PNG\0\0data");
    await editor().openFile("logo.png");
    expect(tab("logo.png").status).toBe("binary");
  });

  it("refreshes tabs after Vinnie changes files", async () => {
    fakes.ws.files.set("client/main.lua", "print('vinnie')\n");
    await editor().filesChanged(["client/main.lua"]);
    expect(tab("client/main.lua").draft).toBe("print('vinnie')\n");
  });

  it("closes tabs and moves focus to a neighbour", async () => {
    fakes.ws.files.set("b.lua", "b");
    await editor().openFile("b.lua");
    editor().close("file:b.lua");
    expect(editor().activeId).toBe("file:client/main.lua");
  });
});
