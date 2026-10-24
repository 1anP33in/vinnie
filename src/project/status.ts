import type { ProjectStatus } from "./types";

/** Explanations for a saved project folder that is no longer usable. */
export const PROJECT_STATUS_TEXT: Record<Exclude<ProjectStatus, "available">, string> = {
  missing: "Folder not found. It may have been moved or deleted.",
  notADirectory: "This path is no longer a folder.",
  inaccessible: "Vinnie can't access this folder.",
};
