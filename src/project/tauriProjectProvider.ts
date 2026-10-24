import { commands } from "@/lib/ipc/commands";
import type { ProjectProvider } from "./types";

export function createTauriProjectProvider(): ProjectProvider {
  return {
    getActive: commands.getProject,
    pickFolder: commands.pickProjectFolder,
    clear: commands.clearProject,
  };
}
