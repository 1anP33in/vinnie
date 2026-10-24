import { VinnieError } from "@/lib/errors";
import type { ProjectInfo } from "@/lib/ipc/types";
import { installFakes, resetStores } from "@/test/fakes";
import { useProjectStore } from "./projectStore";

let fakes: ReturnType<typeof installFakes>;
const store = () => useProjectStore.getState();
const projectA: ProjectInfo = { path: "C:\\code\\alpha", name: "alpha", status: "available" };
const projectB: ProjectInfo = { path: "C:\\code\\beta", name: "beta", status: "available" };

beforeEach(() => {
  resetStores();
  fakes = installFakes();
});

describe("project store", () => {
  it("restores the saved project, including a missing folder", async () => {
    fakes.project.state.saved = { ...projectA, status: "missing" };
    await store().load();
    expect(store().project?.status).toBe("missing");
  });

  it("selects and changes the active folder", async () => {
    fakes.project.state.nextPick = projectA;
    await store().pick();
    expect(store().project).toEqual(projectA);
    fakes.project.state.nextPick = projectB;
    await store().pick();
    expect(store().project).toEqual(projectB);
    expect(fakes.project.state.saved).toEqual(projectB);
  });

  it("keeps the current project when the picker is cancelled", async () => {
    fakes.project.state.nextPick = projectA;
    await store().pick();
    fakes.project.state.nextPick = null;
    await store().pick();
    expect(store().project).toEqual(projectA);
    expect(store().busy).toBe(false);
  });

  it("reports picker errors and clears the project", async () => {
    fakes.project.state.pickError = new VinnieError("validation", "Please choose a folder, not a file.");
    await store().pick();
    expect(store().error?.message).toMatch(/folder/);
    fakes.project.state.saved = projectA;
    await store().load();
    await store().clear();
    expect(store().project).toBeNull();
    expect(fakes.project.state.saved).toBeNull();
  });
});
